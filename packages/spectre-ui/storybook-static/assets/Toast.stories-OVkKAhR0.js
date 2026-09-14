import{j as t}from"./jsx-runtime-DF2Pcvd1.js";import{r as n}from"./index-B2-qRKKC.js";import{r as te}from"./index-kS-9iBlu.js";import{B as s}from"./Button-CYFESGiu.js";import"./_commonjsHelpers-Cpj98o6Y.js";const X=n.createContext(void 0);function b({children:e,position:r="bottom-right",maxToasts:o=5}){const[a,i]=n.useState([]),c=n.useCallback(p=>{const m=Math.random().toString(36).substr(2,9),j={...p,id:m,duration:p.duration??5e3};return i(ee=>[j,...ee].slice(0,o)),m},[o]),u=n.useCallback(p=>{i(m=>m.filter(j=>j.id!==p))},[]),Z=n.useCallback(()=>{i([])},[]);return t.jsxs(X.Provider,{value:{toasts:a,addToast:c,removeToast:u,clearAll:Z},children:[e,t.jsx(se,{toasts:a,position:r,onRemove:u})]})}function d(){const e=n.useContext(X);if(!e)throw new Error("useToast must be used within a ToastProvider");return{toast:n.useCallback(o=>e.addToast(o),[e]),toasts:e.toasts,removeToast:e.removeToast,clearAll:e.clearAll}}function se({toasts:e,position:r,onRemove:o}){return e.length===0?null:te.createPortal(t.jsx("div",{className:`spectre-toast-container spectre-toast-container--${r}`,children:e.map(a=>t.jsx(re,{toast:a,onRemove:o},a.id))}),document.body)}function re({toast:e,onRemove:r}){const[o,a]=n.useState(!1);n.useEffect(()=>{if(e.duration&&e.duration>0){const u=setTimeout(()=>{a(!0),setTimeout(()=>r(e.id),200)},e.duration);return()=>clearTimeout(u)}},[e.id,e.duration,r]);const i=()=>{a(!0),setTimeout(()=>r(e.id),200)},c=oe(e.variant);return t.jsxs("div",{className:`spectre-toast spectre-toast--${e.variant||"default"} ${o?"spectre-toast--exiting":""}`,role:"alert","aria-live":"polite",children:[c&&t.jsx("span",{className:"spectre-toast-icon",children:c}),t.jsxs("div",{className:"spectre-toast-content",children:[t.jsx("span",{className:"spectre-toast-message",children:e.message}),e.description&&t.jsx("span",{className:"spectre-toast-description",children:e.description})]}),e.action&&t.jsx("button",{className:"spectre-toast-action",onClick:e.action.onClick,children:e.action.label}),t.jsx("button",{className:"spectre-toast-close",onClick:i,"aria-label":"Dismiss",children:t.jsx("svg",{viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:t.jsx("path",{d:"M18 6L6 18M6 6l12 12"})})})]})}function oe(e){switch(e){case"success":return t.jsxs("svg",{viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[t.jsx("path",{d:"M22 11.08V12a10 10 0 11-5.93-9.14"}),t.jsx("path",{d:"M22 4L12 14.01l-3-3"})]});case"error":return t.jsxs("svg",{viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[t.jsx("circle",{cx:"12",cy:"12",r:"10"}),t.jsx("path",{d:"M15 9l-6 6M9 9l6 6"})]});case"warning":return t.jsxs("svg",{viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[t.jsx("path",{d:"M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"}),t.jsx("line",{x1:"12",y1:"9",x2:"12",y2:"13"}),t.jsx("line",{x1:"12",y1:"17",x2:"12.01",y2:"17"})]});case"info":return t.jsxs("svg",{viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[t.jsx("circle",{cx:"12",cy:"12",r:"10"}),t.jsx("line",{x1:"12",y1:"16",x2:"12",y2:"12"}),t.jsx("line",{x1:"12",y1:"8",x2:"12.01",y2:"8"})]});default:return null}}try{b.displayName="ToastProvider",b.__docgenInfo={description:"Toast provider component. Wrap your app with this to enable toasts.",displayName:"ToastProvider",props:{position:{defaultValue:{value:"bottom-right"},description:"",name:"position",required:!1,type:{name:"enum",value:[{value:'"top-right"'},{value:'"top-left"'},{value:'"bottom-right"'},{value:'"bottom-left"'},{value:'"top-center"'},{value:'"bottom-center"'}]}},maxToasts:{defaultValue:{value:"5"},description:"",name:"maxToasts",required:!1,type:{name:"number"}}}}}catch{}try{d.displayName="useToast",d.__docgenInfo={description:"Hook to access toast functionality.",displayName:"useToast",props:{}}}catch{}try{Context.displayName="Context",Context.__docgenInfo={description:`Context lets components pass information deep down without explicitly
passing props.

Created from {@link createContext}`,displayName:"Context",props:{}}}catch{}const ue={title:"Components/Toast",parameters:{layout:"centered",docs:{description:{component:`
The Toast component provides non-intrusive notifications for user feedback.

## Setup

Wrap your app with \`ToastProvider\`:

\`\`\`tsx
import { ToastProvider } from '@spectre-ai/ui';

function App() {
  return (
    <ToastProvider position="bottom-right">
      <YourApp />
    </ToastProvider>
  );
}
\`\`\`

## Usage

Use the \`useToast\` hook to trigger toasts:

\`\`\`tsx
import { useToast } from '@spectre-ai/ui';

function MyComponent() {
  const { toast } = useToast();
  
  return (
    <Button onClick={() => toast({ 
      message: 'Success!', 
      variant: 'success' 
    })}>
      Show Toast
    </Button>
  );
}
\`\`\`

## Features

- **Auto-dismiss**: Toasts automatically disappear after a set duration
- **Variants**: success, error, warning, info, default
- **Actions**: Add custom action buttons
- **Positions**: 6 position options
- **Accessibility**: Proper ARIA attributes for screen readers
        `}}},tags:["autodocs"],decorators:[e=>t.jsx(b,{position:"bottom-right",children:t.jsx(e,{})})]};function l({variant:e,message:r,description:o,duration:a,action:i}){const{toast:c}=d();return t.jsxs(s,{onClick:()=>c({message:r,description:o,variant:e,duration:a,action:i}),children:["Show ",e||"default"," toast"]})}const g={render:()=>t.jsx(l,{message:"This is a default toast notification"})},f={render:()=>t.jsx(l,{variant:"success",message:"Transaction successful!",description:"Your trade has been executed."})},x={render:()=>t.jsx(l,{variant:"error",message:"Transaction failed",description:"Insufficient balance for this trade."})},h={render:()=>t.jsx(l,{variant:"warning",message:"High slippage detected",description:"This trade may result in unfavorable rates."})},v={render:()=>t.jsx(l,{variant:"info",message:"New tokens available",description:"5 new tokens have been added to Trending."})},T={render:()=>{const{toast:e}=d();return t.jsx(s,{onClick:()=>e({message:"Token copied to clipboard",variant:"success",action:{label:"Undo",onClick:()=>console.log("Undo clicked")}}),children:"Show toast with action"})}},C={render:()=>t.jsx(l,{message:"This toast stays for 10 seconds",duration:1e4})},y={render:()=>{const{toast:e}=d();return t.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:"12px"},children:[t.jsx(s,{onClick:()=>e({message:"Default notification"}),children:"Default"}),t.jsx(s,{variant:"success",onClick:()=>e({message:"Transaction successful!",description:"Your trade has been executed.",variant:"success"}),children:"Success"}),t.jsx(s,{variant:"danger",onClick:()=>e({message:"Transaction failed",description:"Please try again.",variant:"error"}),children:"Error"}),t.jsx(s,{variant:"secondary",onClick:()=>e({message:"Warning",description:"Proceed with caution.",variant:"warning"}),children:"Warning"}),t.jsx(s,{variant:"ghost",onClick:()=>e({message:"Info",description:"Here is some information.",variant:"info"}),children:"Info"})]})}},k={render:()=>{const{toast:e}=d();return t.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:"12px"},children:[t.jsx(s,{variant:"success",onClick:()=>e({message:"Buy order executed",description:"Bought 1,000 SPECTRE for 0.5 SOL",variant:"success"}),children:"Buy Success"}),t.jsx(s,{variant:"danger",onClick:()=>e({message:"Sell order executed",description:"Sold 500 SPECTRE for 0.25 SOL",variant:"success"}),children:"Sell Success"}),t.jsx(s,{variant:"secondary",onClick:()=>e({message:"Token added to watchlist",variant:"info",action:{label:"View",onClick:()=>console.log("View watchlist")}}),children:"Add to Watchlist"}),t.jsx(s,{variant:"ghost",onClick:()=>e({message:"CA copied to clipboard",variant:"success",duration:2e3}),children:"Copy Address"})]})},parameters:{docs:{description:{story:"Common toast patterns used in the trading platform."}}}};var w,S,B;g.parameters={...g.parameters,docs:{...(w=g.parameters)==null?void 0:w.docs,source:{originalSource:`{
  render: () => <ToastDemo message="This is a default toast notification" />
}`,...(B=(S=g.parameters)==null?void 0:S.docs)==null?void 0:B.source}}};var _,A,D;f.parameters={...f.parameters,docs:{...(_=f.parameters)==null?void 0:_.docs,source:{originalSource:`{
  render: () => <ToastDemo variant="success" message="Transaction successful!" description="Your trade has been executed." />
}`,...(D=(A=f.parameters)==null?void 0:A.docs)==null?void 0:D.source}}};var E,P,W;x.parameters={...x.parameters,docs:{...(E=x.parameters)==null?void 0:E.docs,source:{originalSource:`{
  render: () => <ToastDemo variant="error" message="Transaction failed" description="Insufficient balance for this trade." />
}`,...(W=(P=x.parameters)==null?void 0:P.docs)==null?void 0:W.source}}};var N,I,L;h.parameters={...h.parameters,docs:{...(N=h.parameters)==null?void 0:N.docs,source:{originalSource:`{
  render: () => <ToastDemo variant="warning" message="High slippage detected" description="This trade may result in unfavorable rates." />
}`,...(L=(I=h.parameters)==null?void 0:I.docs)==null?void 0:L.source}}};var V,M,U;v.parameters={...v.parameters,docs:{...(V=v.parameters)==null?void 0:V.docs,source:{originalSource:`{
  render: () => <ToastDemo variant="info" message="New tokens available" description="5 new tokens have been added to Trending." />
}`,...(U=(M=v.parameters)==null?void 0:M.docs)==null?void 0:U.source}}};var H,O,R;T.parameters={...T.parameters,docs:{...(H=T.parameters)==null?void 0:H.docs,source:{originalSource:`{
  render: () => {
    const {
      toast
    } = useToast();
    return <Button onClick={() => toast({
      message: 'Token copied to clipboard',
      variant: 'success',
      action: {
        label: 'Undo',
        onClick: () => console.log('Undo clicked')
      }
    })}>\r
        Show toast with action\r
      </Button>;
  }
}`,...(R=(O=T.parameters)==null?void 0:O.docs)==null?void 0:R.source}}};var Y,$,q;C.parameters={...C.parameters,docs:{...(Y=C.parameters)==null?void 0:Y.docs,source:{originalSource:`{
  render: () => <ToastDemo message="This toast stays for 10 seconds" duration={10000} />
}`,...(q=($=C.parameters)==null?void 0:$.docs)==null?void 0:q.source}}};var z,F,G;y.parameters={...y.parameters,docs:{...(z=y.parameters)==null?void 0:z.docs,source:{originalSource:`{
  render: () => {
    const {
      toast
    } = useToast();
    return <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }}>\r
        <Button onClick={() => toast({
        message: 'Default notification'
      })}>\r
          Default\r
        </Button>\r
        <Button variant="success" onClick={() => toast({
        message: 'Transaction successful!',
        description: 'Your trade has been executed.',
        variant: 'success'
      })}>\r
          Success\r
        </Button>\r
        <Button variant="danger" onClick={() => toast({
        message: 'Transaction failed',
        description: 'Please try again.',
        variant: 'error'
      })}>\r
          Error\r
        </Button>\r
        <Button variant="secondary" onClick={() => toast({
        message: 'Warning',
        description: 'Proceed with caution.',
        variant: 'warning'
      })}>\r
          Warning\r
        </Button>\r
        <Button variant="ghost" onClick={() => toast({
        message: 'Info',
        description: 'Here is some information.',
        variant: 'info'
      })}>\r
          Info\r
        </Button>\r
      </div>;
  }
}`,...(G=(F=y.parameters)==null?void 0:F.docs)==null?void 0:G.source}}};var J,K,Q;k.parameters={...k.parameters,docs:{...(J=k.parameters)==null?void 0:J.docs,source:{originalSource:`{
  render: () => {
    const {
      toast
    } = useToast();
    return <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }}>\r
        <Button variant="success" onClick={() => toast({
        message: 'Buy order executed',
        description: 'Bought 1,000 SPECTRE for 0.5 SOL',
        variant: 'success'
      })}>\r
          Buy Success\r
        </Button>\r
        <Button variant="danger" onClick={() => toast({
        message: 'Sell order executed',
        description: 'Sold 500 SPECTRE for 0.25 SOL',
        variant: 'success'
      })}>\r
          Sell Success\r
        </Button>\r
        <Button variant="secondary" onClick={() => toast({
        message: 'Token added to watchlist',
        variant: 'info',
        action: {
          label: 'View',
          onClick: () => console.log('View watchlist')
        }
      })}>\r
          Add to Watchlist\r
        </Button>\r
        <Button variant="ghost" onClick={() => toast({
        message: 'CA copied to clipboard',
        variant: 'success',
        duration: 2000
      })}>\r
          Copy Address\r
        </Button>\r
      </div>;
  },
  parameters: {
    docs: {
      description: {
        story: 'Common toast patterns used in the trading platform.'
      }
    }
  }
}`,...(Q=(K=k.parameters)==null?void 0:K.docs)==null?void 0:Q.source}}};const pe=["Default","Success","Error","Warning","Info","WithAction","LongDuration","AllVariants","TradingToasts"];export{y as AllVariants,g as Default,x as Error,v as Info,C as LongDuration,f as Success,k as TradingToasts,h as Warning,T as WithAction,pe as __namedExportsOrder,ue as default};
