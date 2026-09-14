'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { exec }  = require('child_process');
const axios     = require('axios');
const os        = require('os');
const fs        = require('fs');
const path      = require('path');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Voice → structured command ─────────────────────────────────
async function parseTradingViewCommand(transcript) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Parse this TradingView voice command into JSON.
Command: "${transcript}"
Return ONLY valid JSON:
{
  "action": "drawLine|addIndicator|setAlert|drawFib|mondayOpen|weeklyOpen",
  "params": {
    "type": "support|resistance|mondayOpen|weeklyOpen",
    "price": number or null,
    "indicator": "RSI|MACD|BB|EMA|SMA|VWAP" or null,
    "period": number or null,
    "from": number or null,
    "to": number or null
  }
}`
    }]
  });

  const raw = response.content[0].text.trim().replace(/```json|```/g, '').trim();
  return JSON.parse(raw);
}

// ── Monday open from Binance ───────────────────────────────────
async function getMondayOpenPrice(symbol) {
  const now    = new Date();
  const day    = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);

  try {
    const res = await axios.get(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&startTime=${monday.getTime()}&limit=1`
    );
    return parseFloat(res.data[0][1]);
  } catch (e) { return null; }
}

// ── Inline JS that runs directly in Chrome tab ─────────────────
// No content script needed — AppleScript executes this in the page
const TV_BRIDGE_CODE = `
(function(){
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var simKey=function(el,key,opts){
    opts=Object.assign({key:key,code:'Key'+key.toUpperCase(),bubbles:true,cancelable:true},opts||{});
    el.dispatchEvent(new KeyboardEvent('keydown',opts));
    el.dispatchEvent(new KeyboardEvent('keyup',opts));
  };
  var getChart=function(){
    return document.querySelector('.chart-container')||
           document.querySelector('[class*="chart"]')||
           document.body;
  };
  var setNativeValue=function(el,val){
    var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    setter.call(el,val);
    el.dispatchEvent(new Event('input',{bubbles:true}));
  };

  var handlers={
    addIndicator:async function(p){
      var chart=getChart();
      simKey(chart,'/',{code:'Slash'});
      await sleep(500);
      var input=document.querySelector('[data-name="indicators-search"]')||
                document.querySelector('input[placeholder*="Search"]')||
                document.querySelector('[class*="searchInput"] input')||
                document.querySelector('input[class*="input"]');
      if(input){
        input.focus();
        setNativeValue(input,p.indicator||p.name||'RSI');
        await sleep(700);
        var item=document.querySelector('[data-name="indicator-item"]')||
                 document.querySelector('[class*="listItem"]');
        if(item)item.click();
        await sleep(200);
        simKey(document.body,'Escape',{code:'Escape'});
      }
      return {ok:true,action:'addIndicator'};
    },
    drawLine:async function(p){
      var chart=getChart();
      if(p.type==='support'||p.type==='resistance'){
        simKey(chart,'t',{code:'KeyT',altKey:true});
      }else{
        simKey(chart,'h',{code:'KeyH',altKey:true});
      }
      await sleep(300);
      return {ok:true,action:'drawLine',type:p.type};
    },
    drawFib:async function(){
      var chart=getChart();
      simKey(chart,'f',{code:'KeyF',altKey:true});
      await sleep(300);
      return {ok:true,action:'drawFib'};
    },
    setAlert:async function(p){
      var chart=getChart();
      simKey(chart,'a',{code:'KeyA',altKey:true});
      await sleep(500);
      return {ok:true,action:'setAlert',price:p.price};
    },
    mondayOpen:async function(p){
      var chart=getChart();
      simKey(chart,'h',{code:'KeyH',altKey:true});
      await sleep(300);
      return {ok:true,action:'mondayOpen',price:p.price};
    },
    weeklyOpen:async function(p){
      var chart=getChart();
      simKey(chart,'h',{code:'KeyH',altKey:true});
      await sleep(300);
      return {ok:true,action:'weeklyOpen',price:p.price};
    }
  };

  var CMD=__PAYLOAD__;
  var fn=handlers[CMD.action];
  if(fn)fn(CMD.params||{}).then(function(r){console.log('[Spectre TV]',JSON.stringify(r))});
  else console.warn('[Spectre TV] Unknown action:',CMD.action);
})()
`;

// ── Execute via AppleScript → Chrome ───────────────────────────
async function executeTVCommand(parsed, context) {
  const symbol = context.currentSymbol || context.symbol || '';

  if (parsed.action === 'mondayOpen' || parsed.action === 'weeklyOpen') {
    parsed.params = parsed.params || {};
    parsed.params.price = await getMondayOpenPrice(symbol);
  }

  // Inject the payload into the bridge code
  const payloadLiteral = JSON.stringify(parsed);
  const jsCode = TV_BRIDGE_CODE.replace('__PAYLOAD__', payloadLiteral)
    .replace(/\n/g, ' ')       // flatten to single line
    .replace(/\s{2,}/g, ' ');  // collapse whitespace

  // Encode as base64 to avoid all quoting nightmares
  const b64 = Buffer.from(jsCode).toString('base64');
  const evalCode = `eval(atob('${b64}'))`;

  // Write AppleScript to temp file
  const tmp  = path.join(os.tmpdir(), 'spectre-tv.scpt');
  const scpt = [
    'tell application "Google Chrome"',
    '  set activeTab to active tab of front window',
    `  execute activeTab javascript "${evalCode}"`,
    'end tell',
  ].join('\n');

  fs.writeFileSync(tmp, scpt, 'utf8');

  return new Promise((resolve, reject) => {
    exec(`osascript "${tmp}"`, { timeout: 8000 }, (err) => {
      try { fs.unlinkSync(tmp); } catch (_) {}
      if (err) reject(err); else resolve(parsed);
    });
  });
}

module.exports = { parseTradingViewCommand, executeTVCommand, getMondayOpenPrice };
