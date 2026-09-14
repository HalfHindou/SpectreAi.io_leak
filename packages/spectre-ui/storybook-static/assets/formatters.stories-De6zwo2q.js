import{j as o}from"./jsx-runtime-DF2Pcvd1.js";import"./index-B2-qRKKC.js";import"./_commonjsHelpers-Cpj98o6Y.js";function c(t,r="USD",e){return new Intl.NumberFormat("en-US",{style:"currency",currency:r,minimumFractionDigits:e,maximumFractionDigits:e??(t<1?8:2)}).format(t)}function i(t){if(t===0)return"0";const r=["","K","M","B","T"],e=Math.floor(Math.log10(Math.abs(t))/3);if(e===0)return t.toString();const a=r[e]||"",u=Math.pow(10,e*3);return(t/u).toFixed(2).replace(/\.?0+$/,"")+a}function l(t,r=2,e=!1){const a=t*100,u=a.toFixed(r);return e&&a>0?`+${u}%`:`${u}%`}function T(t){const r=t>0?"up":t<0?"down":"neutral";return{value:`${t>0?"+":""}${(t*100).toFixed(2)}%`,direction:r}}function m(t,r=8){if(t===0)return"0";const e=Math.abs(t);let a;return e>=1e3?a=2:e>=1?a=4:e>=1e-4?a=6:a=r,new Intl.NumberFormat("en-US",{minimumFractionDigits:0,maximumFractionDigits:a}).format(t)}function w(t,r=6,e=4){return t.length<=r+e?t:`${t.slice(0,r)}...${t.slice(-e)}`}function p(t){const r=t instanceof Date?t:new Date(t),a=new Date().getTime()-r.getTime(),u=Math.floor(a/1e3),s=Math.floor(u/60),A=Math.floor(s/60),b=Math.floor(A/24);return u<60?"just now":s<60?`${s}m ago`:A<24?`${A}h ago`:b<7?`${b}d ago`:r.toLocaleDateString("en-US",{month:"short",day:"numeric"})}function P(t,r="short"){const e=new Date(t);switch(r){case"long":return e.toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric",hour:"numeric",minute:"2-digit"});case"time":return e.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});default:return e.toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"})}}function f(t){if(t===0)return"$0";const r=["","K","M","B","T"],e=Math.floor(Math.log10(Math.abs(t))/3);if(e===0)return`$${t}`;const a=r[e]||"",u=Math.pow(10,e*3);return`$${(t/u).toFixed(2)}${a}`}function rt(t,r){return new Intl.NumberFormat("en-US",{minimumFractionDigits:r,maximumFractionDigits:r}).format(t)}function F(t,r,e){return`${t} ${t===1?r:e}`}const ut={title:"Utilities/Formatters",parameters:{docs:{description:{component:`
Text formatting utilities for trading and fintech applications.

## Installation

\`\`\`tsx
import { 
  formatCurrency, 
  formatCompact, 
  formatPercent,
  formatPriceChange,
  formatTokenAmount,
  truncateAddress,
  formatRelativeTime,
  formatMarketCap 
} from '@spectre-ai/ui';
\`\`\`

## Usage Examples

All formatters are pure functions that take values and return formatted strings.
        `}}},tags:["autodocs"]};function n({title:t,examples:r}){return o.jsxs("div",{style:{marginBottom:"32px"},children:[o.jsx("h3",{style:{marginBottom:"16px",color:"var(--spectre-text-primary)"},children:t}),o.jsx("div",{style:{background:"var(--spectre-bg-surface)",borderRadius:"8px",overflow:"hidden",border:"1px solid var(--spectre-border-default)"},children:r.map((e,a)=>o.jsxs("div",{style:{display:"flex",borderBottom:a<r.length-1?"1px solid var(--spectre-border-subtle)":"none"},children:[o.jsx("code",{style:{flex:1,padding:"12px 16px",color:"var(--spectre-text-secondary)",fontFamily:"var(--spectre-font-mono)",fontSize:"0.875rem",borderRight:"1px solid var(--spectre-border-subtle)"},children:e.input}),o.jsx("code",{style:{flex:1,padding:"12px 16px",color:"var(--spectre-accent)",fontFamily:"var(--spectre-font-mono)",fontSize:"0.875rem"},children:e.output})]},a))})]})}const d={render:()=>o.jsx(n,{title:"formatCurrency(value, currency?, decimals?)",examples:[{input:"formatCurrency(1234.56)",output:c(1234.56)},{input:'formatCurrency(1234.56, "EUR")',output:c(1234.56,"EUR")},{input:'formatCurrency(0.00001234, "USD", 8)',output:c(1234e-8,"USD",8)},{input:"formatCurrency(1234567.89)",output:c(123456789e-2)}]})},x={render:()=>o.jsx(n,{title:"formatCompact(value)",examples:[{input:"formatCompact(999)",output:i(999)},{input:"formatCompact(1234)",output:i(1234)},{input:"formatCompact(1234567)",output:i(1234567)},{input:"formatCompact(1234567890)",output:i(1234567890)},{input:"formatCompact(1234567890123)",output:i(1234567890123)}]})},v={render:()=>o.jsx(n,{title:"formatPercent(value, decimals?, includeSign?)",examples:[{input:"formatPercent(0.1234)",output:l(.1234)},{input:"formatPercent(0.1234, 1)",output:l(.1234,1)},{input:"formatPercent(0.1234, 2, true)",output:l(.1234,2,!0)},{input:"formatPercent(-0.05)",output:l(-.05)}]})},C={render:()=>{const t=T(.0534),r=T(-.0234),e=T(0);return o.jsxs("div",{children:[o.jsx(n,{title:"formatPriceChange(value)",examples:[{input:"formatPriceChange(0.0534)",output:`{ value: "${t.value}", direction: "${t.direction}" }`},{input:"formatPriceChange(-0.0234)",output:`{ value: "${r.value}", direction: "${r.direction}" }`},{input:"formatPriceChange(0)",output:`{ value: "${e.value}", direction: "${e.direction}" }`}]}),o.jsxs("div",{style:{marginTop:"16px"},children:[o.jsx("h4",{style:{marginBottom:"8px"},children:"Visual Example:"}),o.jsxs("div",{style:{display:"flex",gap:"16px"},children:[o.jsxs("span",{style:{color:"var(--spectre-bull)",fontFamily:"var(--spectre-font-mono)"},children:["↑ ",t.value]}),o.jsxs("span",{style:{color:"var(--spectre-bear)",fontFamily:"var(--spectre-font-mono)"},children:["↓ ",r.value]})]})]})]})}},g={render:()=>o.jsx(n,{title:"formatTokenAmount(value, maxDecimals?)",examples:[{input:"formatTokenAmount(1234567890)",output:m(1234567890)},{input:"formatTokenAmount(1234.567)",output:m(1234.567)},{input:"formatTokenAmount(1.234567)",output:m(1.234567)},{input:"formatTokenAmount(0.00001234)",output:m(1234e-8)},{input:"formatTokenAmount(0.00000001)",output:m(1e-8)}]})},h={render:()=>o.jsx(n,{title:"truncateAddress(address, startChars?, endChars?)",examples:[{input:'truncateAddress("0x1234567890abcdef...")',output:w("0x1234567890abcdef1234567890abcdef12345678")},{input:'truncateAddress("0x1234...", 8, 6)',output:w("0x1234567890abcdef1234567890abcdef12345678",8,6)},{input:'truncateAddress("short")',output:w("short")}]})},y={render:()=>o.jsx(n,{title:"formatRelativeTime(timestamp)",examples:[{input:"formatRelativeTime(now - 30s)",output:p(Date.now()-3e4)},{input:"formatRelativeTime(now - 5m)",output:p(Date.now()-3e5)},{input:"formatRelativeTime(now - 2h)",output:p(Date.now()-72e5)},{input:"formatRelativeTime(now - 1d)",output:p(Date.now()-864e5)},{input:"formatRelativeTime(now - 7d)",output:p(Date.now()-6048e5)}]})},k={render:()=>o.jsx(n,{title:"formatMarketCap(value)",examples:[{input:"formatMarketCap(1234)",output:f(1234)},{input:"formatMarketCap(1234567)",output:f(1234567)},{input:"formatMarketCap(1234567890)",output:f(1234567890)},{input:"formatMarketCap(123456789012)",output:f(123456789012)}]})},D={render:()=>o.jsxs("div",{children:[o.jsx("h2",{style:{marginBottom:"24px"},children:"All Formatters Overview"}),o.jsx(n,{title:"Currency & Numbers",examples:[{input:"formatCurrency(1234.56)",output:c(1234.56)},{input:"formatCompact(1234567)",output:i(1234567)},{input:"formatNumber(1234567.89)",output:rt(123456789e-2)},{input:"formatMarketCap(1234567890)",output:f(1234567890)}]}),o.jsx(n,{title:"Percentages",examples:[{input:"formatPercent(0.1234)",output:l(.1234)},{input:"formatPriceChange(0.05).value",output:T(.05).value}]}),o.jsx(n,{title:"Crypto-specific",examples:[{input:"formatTokenAmount(0.00001234)",output:m(1234e-8)},{input:'truncateAddress("0x1234...")',output:w("0x1234567890abcdef1234567890abcdef12345678")}]}),o.jsx(n,{title:"Time & Date",examples:[{input:"formatRelativeTime(now - 1h)",output:p(Date.now()-36e5)},{input:"formatDate(new Date())",output:P(new Date)},{input:'formatDate(new Date(), "long")',output:P(new Date,"long")}]}),o.jsx(n,{title:"Utilities",examples:[{input:'pluralize(1, "token", "tokens")',output:F(1,"token","tokens")},{input:'pluralize(5, "token", "tokens")',output:F(5,"token","tokens")}]})]}),parameters:{docs:{description:{story:"Complete overview of all available formatters."}}}};var M,R,j;d.parameters={...d.parameters,docs:{...(M=d.parameters)==null?void 0:M.docs,source:{originalSource:`{
  render: () => <FormatterDemo title="formatCurrency(value, currency?, decimals?)" examples={[{
    input: 'formatCurrency(1234.56)',
    output: formatCurrency(1234.56)
  }, {
    input: 'formatCurrency(1234.56, "EUR")',
    output: formatCurrency(1234.56, 'EUR')
  }, {
    input: 'formatCurrency(0.00001234, "USD", 8)',
    output: formatCurrency(0.00001234, 'USD', 8)
  }, {
    input: 'formatCurrency(1234567.89)',
    output: formatCurrency(1234567.89)
  }]} />
}`,...(j=(R=d.parameters)==null?void 0:R.docs)==null?void 0:j.source}}};var S,$,U;x.parameters={...x.parameters,docs:{...(S=x.parameters)==null?void 0:S.docs,source:{originalSource:`{
  render: () => <FormatterDemo title="formatCompact(value)" examples={[{
    input: 'formatCompact(999)',
    output: formatCompact(999)
  }, {
    input: 'formatCompact(1234)',
    output: formatCompact(1234)
  }, {
    input: 'formatCompact(1234567)',
    output: formatCompact(1234567)
  }, {
    input: 'formatCompact(1234567890)',
    output: formatCompact(1234567890)
  }, {
    input: 'formatCompact(1234567890123)',
    output: formatCompact(1234567890123)
  }]} />
}`,...(U=($=x.parameters)==null?void 0:$.docs)==null?void 0:U.source}}};var z,B,E;v.parameters={...v.parameters,docs:{...(z=v.parameters)==null?void 0:z.docs,source:{originalSource:`{
  render: () => <FormatterDemo title="formatPercent(value, decimals?, includeSign?)" examples={[{
    input: 'formatPercent(0.1234)',
    output: formatPercent(0.1234)
  }, {
    input: 'formatPercent(0.1234, 1)',
    output: formatPercent(0.1234, 1)
  }, {
    input: 'formatPercent(0.1234, 2, true)',
    output: formatPercent(0.1234, 2, true)
  }, {
    input: 'formatPercent(-0.05)',
    output: formatPercent(-0.05)
  }]} />
}`,...(E=(B=v.parameters)==null?void 0:B.docs)==null?void 0:E.source}}};var N,I,L;C.parameters={...C.parameters,docs:{...(N=C.parameters)==null?void 0:N.docs,source:{originalSource:`{
  render: () => {
    const up = formatPriceChange(0.0534);
    const down = formatPriceChange(-0.0234);
    const neutral = formatPriceChange(0);
    return <div>\r
        <FormatterDemo title="formatPriceChange(value)" examples={[{
        input: 'formatPriceChange(0.0534)',
        output: \`{ value: "\${up.value}", direction: "\${up.direction}" }\`
      }, {
        input: 'formatPriceChange(-0.0234)',
        output: \`{ value: "\${down.value}", direction: "\${down.direction}" }\`
      }, {
        input: 'formatPriceChange(0)',
        output: \`{ value: "\${neutral.value}", direction: "\${neutral.direction}" }\`
      }]} />\r
        <div style={{
        marginTop: '16px'
      }}>\r
          <h4 style={{
          marginBottom: '8px'
        }}>Visual Example:</h4>\r
          <div style={{
          display: 'flex',
          gap: '16px'
        }}>\r
            <span style={{
            color: 'var(--spectre-bull)',
            fontFamily: 'var(--spectre-font-mono)'
          }}>\r
              ↑ {up.value}\r
            </span>\r
            <span style={{
            color: 'var(--spectre-bear)',
            fontFamily: 'var(--spectre-font-mono)'
          }}>\r
              ↓ {down.value}\r
            </span>\r
          </div>\r
        </div>\r
      </div>;
  }
}`,...(L=(I=C.parameters)==null?void 0:I.docs)==null?void 0:L.source}}};var O,V,K;g.parameters={...g.parameters,docs:{...(O=g.parameters)==null?void 0:O.docs,source:{originalSource:`{
  render: () => <FormatterDemo title="formatTokenAmount(value, maxDecimals?)" examples={[{
    input: 'formatTokenAmount(1234567890)',
    output: formatTokenAmount(1234567890)
  }, {
    input: 'formatTokenAmount(1234.567)',
    output: formatTokenAmount(1234.567)
  }, {
    input: 'formatTokenAmount(1.234567)',
    output: formatTokenAmount(1.234567)
  }, {
    input: 'formatTokenAmount(0.00001234)',
    output: formatTokenAmount(0.00001234)
  }, {
    input: 'formatTokenAmount(0.00000001)',
    output: formatTokenAmount(0.00000001)
  }]} />
}`,...(K=(V=g.parameters)==null?void 0:V.docs)==null?void 0:K.source}}};var _,q,G;h.parameters={...h.parameters,docs:{...(_=h.parameters)==null?void 0:_.docs,source:{originalSource:`{
  render: () => <FormatterDemo title="truncateAddress(address, startChars?, endChars?)" examples={[{
    input: 'truncateAddress("0x1234567890abcdef...")',
    output: truncateAddress('0x1234567890abcdef1234567890abcdef12345678')
  }, {
    input: 'truncateAddress("0x1234...", 8, 6)',
    output: truncateAddress('0x1234567890abcdef1234567890abcdef12345678', 8, 6)
  }, {
    input: 'truncateAddress("short")',
    output: truncateAddress('short')
  }]} />
}`,...(G=(q=h.parameters)==null?void 0:q.docs)==null?void 0:G.source}}};var H,J,Q;y.parameters={...y.parameters,docs:{...(H=y.parameters)==null?void 0:H.docs,source:{originalSource:`{
  render: () => <FormatterDemo title="formatRelativeTime(timestamp)" examples={[{
    input: 'formatRelativeTime(now - 30s)',
    output: formatRelativeTime(Date.now() - 30000)
  }, {
    input: 'formatRelativeTime(now - 5m)',
    output: formatRelativeTime(Date.now() - 300000)
  }, {
    input: 'formatRelativeTime(now - 2h)',
    output: formatRelativeTime(Date.now() - 7200000)
  }, {
    input: 'formatRelativeTime(now - 1d)',
    output: formatRelativeTime(Date.now() - 86400000)
  }, {
    input: 'formatRelativeTime(now - 7d)',
    output: formatRelativeTime(Date.now() - 604800000)
  }]} />
}`,...(Q=(J=y.parameters)==null?void 0:J.docs)==null?void 0:Q.source}}};var W,X,Y;k.parameters={...k.parameters,docs:{...(W=k.parameters)==null?void 0:W.docs,source:{originalSource:`{
  render: () => <FormatterDemo title="formatMarketCap(value)" examples={[{
    input: 'formatMarketCap(1234)',
    output: formatMarketCap(1234)
  }, {
    input: 'formatMarketCap(1234567)',
    output: formatMarketCap(1234567)
  }, {
    input: 'formatMarketCap(1234567890)',
    output: formatMarketCap(1234567890)
  }, {
    input: 'formatMarketCap(123456789012)',
    output: formatMarketCap(123456789012)
  }]} />
}`,...(Y=(X=k.parameters)==null?void 0:X.docs)==null?void 0:Y.source}}};var Z,tt,et;D.parameters={...D.parameters,docs:{...(Z=D.parameters)==null?void 0:Z.docs,source:{originalSource:`{
  render: () => <div>\r
      <h2 style={{
      marginBottom: '24px'
    }}>All Formatters Overview</h2>\r
      \r
      <FormatterDemo title="Currency & Numbers" examples={[{
      input: 'formatCurrency(1234.56)',
      output: formatCurrency(1234.56)
    }, {
      input: 'formatCompact(1234567)',
      output: formatCompact(1234567)
    }, {
      input: 'formatNumber(1234567.89)',
      output: formatNumber(1234567.89)
    }, {
      input: 'formatMarketCap(1234567890)',
      output: formatMarketCap(1234567890)
    }]} />\r
      \r
      <FormatterDemo title="Percentages" examples={[{
      input: 'formatPercent(0.1234)',
      output: formatPercent(0.1234)
    }, {
      input: 'formatPriceChange(0.05).value',
      output: formatPriceChange(0.05).value
    }]} />\r
      \r
      <FormatterDemo title="Crypto-specific" examples={[{
      input: 'formatTokenAmount(0.00001234)',
      output: formatTokenAmount(0.00001234)
    }, {
      input: 'truncateAddress("0x1234...")',
      output: truncateAddress('0x1234567890abcdef1234567890abcdef12345678')
    }]} />\r
      \r
      <FormatterDemo title="Time & Date" examples={[{
      input: 'formatRelativeTime(now - 1h)',
      output: formatRelativeTime(Date.now() - 3600000)
    }, {
      input: 'formatDate(new Date())',
      output: formatDate(new Date())
    }, {
      input: 'formatDate(new Date(), "long")',
      output: formatDate(new Date(), 'long')
    }]} />\r
      \r
      <FormatterDemo title="Utilities" examples={[{
      input: 'pluralize(1, "token", "tokens")',
      output: pluralize(1, 'token', 'tokens')
    }, {
      input: 'pluralize(5, "token", "tokens")',
      output: pluralize(5, 'token', 'tokens')
    }]} />\r
    </div>,
  parameters: {
    docs: {
      description: {
        story: 'Complete overview of all available formatters.'
      }
    }
  }
}`,...(et=(tt=D.parameters)==null?void 0:tt.docs)==null?void 0:et.source}}};const it=["Currency","Compact","Percent","PriceChange","TokenAmount","TruncateAddress","RelativeTime","MarketCap","AllFormatters"];export{D as AllFormatters,x as Compact,d as Currency,k as MarketCap,v as Percent,C as PriceChange,y as RelativeTime,g as TokenAmount,h as TruncateAddress,it as __namedExportsOrder,ut as default};
