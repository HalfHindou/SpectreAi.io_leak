import{j as e}from"./jsx-runtime-DF2Pcvd1.js";import{fn as xe}from"./index-CLEdRh-S.js";import{I as r}from"./Input-BO4WT-n1.js";import"./index-B2-qRKKC.js";import"./_commonjsHelpers-Cpj98o6Y.js";const Ie={title:"Components/Input",component:r,parameters:{layout:"centered",docs:{description:{component:`
The Input component handles all text-based user input in the Spectre ecosystem.

## Features

- **Labels & Helper Text**: Built-in support for accessible labels
- **Error States**: Visual and accessible error handling
- **Icons**: Support for left/right icons or custom elements
- **Password Toggle**: Built-in show/hide for password inputs
- **Sizes**: Three size variants for different contexts

## Accessibility

- Labels are properly associated with inputs via \`htmlFor\`
- Error messages use \`role="alert"\` and \`aria-describedby\`
- \`aria-invalid\` is set when errors are present
        `}}},tags:["autodocs"],argTypes:{size:{control:"select",options:["sm","md","lg"]},type:{control:"select",options:["text","password","email","number","search"]},fullWidth:{control:"boolean"},disabled:{control:"boolean"}},args:{onChange:xe()}},a={args:{placeholder:"Enter text..."}},s={args:{label:"Token Address",placeholder:"Enter token address..."}},t={args:{label:"Wallet Address",placeholder:"0x...",helperText:"Enter your Solana or Ethereum wallet address"}},o={args:{label:"Amount",placeholder:"0.00",error:"Insufficient balance",defaultValue:"1000"}},l={args:{label:"Password",type:"password",placeholder:"Enter password..."},parameters:{docs:{description:{story:"Password input with built-in show/hide toggle."}}}},n={args:{label:"Amount",type:"number",placeholder:"0.00"}},d={args:{type:"search",placeholder:"Search tokens, wallets, or paste address...",leftElement:e.jsxs("svg",{viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[e.jsx("circle",{cx:"11",cy:"11",r:"8"}),e.jsx("path",{d:"M21 21l-4.35-4.35"})]})}},c={args:{size:"sm",placeholder:"Small input"}},p={args:{size:"md",placeholder:"Medium input"}},i={args:{size:"lg",placeholder:"Large input"}},u={args:{disabled:!0,placeholder:"Disabled input",defaultValue:"Cannot edit"}},m={args:{fullWidth:!0,label:"Full Width Input",placeholder:"Takes full container width"},parameters:{layout:"padded"}},y=()=>e.jsxs("svg",{viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[e.jsx("circle",{cx:"11",cy:"11",r:"8"}),e.jsx("path",{d:"M21 21l-4.35-4.35"})]}),w=()=>e.jsx("span",{style:{fontSize:"0.75rem",fontWeight:600,color:"var(--spectre-text-secondary)",background:"var(--spectre-bg-elevated)",padding:"2px 8px",borderRadius:"var(--spectre-radius-sm)"},children:"SOL"}),h={args:{leftElement:e.jsx(y,{}),placeholder:"Search..."}},g={args:{label:"Amount",placeholder:"0.00",rightElement:e.jsx(w,{}),type:"number"}},b={args:{placeholder:"Search tokens, wallets, or paste address...",leftElement:e.jsx(y,{}),size:"lg",fullWidth:!0},parameters:{layout:"padded",docs:{description:{story:"Used in the header for searching tokens and wallets."}}}},f={args:{label:"You Pay",placeholder:"0.00",type:"number",rightElement:e.jsx(w,{}),helperText:"Balance: 10.5 SOL",fullWidth:!0},parameters:{layout:"padded",docs:{description:{story:"Used in the swap widget for entering trade amounts."}}}},x={render:()=>e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:"24px",width:"320px"},children:[e.jsx(r,{label:"Default",placeholder:"Enter text..."}),e.jsx(r,{label:"With Helper",placeholder:"Enter...",helperText:"This is helper text"}),e.jsx(r,{label:"With Error",placeholder:"Enter...",error:"This field is required"}),e.jsx(r,{label:"Password",type:"password",placeholder:"Enter password..."}),e.jsx(r,{placeholder:"Search...",leftElement:e.jsx(y,{})}),e.jsx(r,{label:"Amount",type:"number",placeholder:"0.00",rightElement:e.jsx(w,{})}),e.jsx(r,{label:"Disabled",disabled:!0,defaultValue:"Cannot edit"})]}),parameters:{docs:{description:{story:"Overview of all input variants and states."}}}};var S,E,W;a.parameters={...a.parameters,docs:{...(S=a.parameters)==null?void 0:S.docs,source:{originalSource:`{
  args: {
    placeholder: 'Enter text...'
  }
}`,...(W=(E=a.parameters)==null?void 0:E.docs)==null?void 0:W.source}}};var I,j,v;s.parameters={...s.parameters,docs:{...(I=s.parameters)==null?void 0:I.docs,source:{originalSource:`{
  args: {
    label: 'Token Address',
    placeholder: 'Enter token address...'
  }
}`,...(v=(j=s.parameters)==null?void 0:j.docs)==null?void 0:v.source}}};var T,k,A;t.parameters={...t.parameters,docs:{...(T=t.parameters)==null?void 0:T.docs,source:{originalSource:`{
  args: {
    label: 'Wallet Address',
    placeholder: '0x...',
    helperText: 'Enter your Solana or Ethereum wallet address'
  }
}`,...(A=(k=t.parameters)==null?void 0:k.docs)==null?void 0:A.source}}};var C,L,z;o.parameters={...o.parameters,docs:{...(C=o.parameters)==null?void 0:C.docs,source:{originalSource:`{
  args: {
    label: 'Amount',
    placeholder: '0.00',
    error: 'Insufficient balance',
    defaultValue: '1000'
  }
}`,...(z=(L=o.parameters)==null?void 0:L.docs)==null?void 0:z.source}}};var D,B,P;l.parameters={...l.parameters,docs:{...(D=l.parameters)==null?void 0:D.docs,source:{originalSource:`{
  args: {
    label: 'Password',
    type: 'password',
    placeholder: 'Enter password...'
  },
  parameters: {
    docs: {
      description: {
        story: 'Password input with built-in show/hide toggle.'
      }
    }
  }
}`,...(P=(B=l.parameters)==null?void 0:B.docs)==null?void 0:P.source}}};var V,M,F;n.parameters={...n.parameters,docs:{...(V=n.parameters)==null?void 0:V.docs,source:{originalSource:`{
  args: {
    label: 'Amount',
    type: 'number',
    placeholder: '0.00'
  }
}`,...(F=(M=n.parameters)==null?void 0:M.docs)==null?void 0:F.source}}};var O,H,R;d.parameters={...d.parameters,docs:{...(O=d.parameters)==null?void 0:O.docs,source:{originalSource:`{
  args: {
    type: 'search',
    placeholder: 'Search tokens, wallets, or paste address...',
    leftElement: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">\r
        <circle cx="11" cy="11" r="8" />\r
        <path d="M21 21l-4.35-4.35" />\r
      </svg>
  }
}`,...(R=(H=d.parameters)==null?void 0:H.docs)==null?void 0:R.source}}};var U,q,N;c.parameters={...c.parameters,docs:{...(U=c.parameters)==null?void 0:U.docs,source:{originalSource:`{
  args: {
    size: 'sm',
    placeholder: 'Small input'
  }
}`,...(N=(q=c.parameters)==null?void 0:q.docs)==null?void 0:N.source}}};var Y,_,G;p.parameters={...p.parameters,docs:{...(Y=p.parameters)==null?void 0:Y.docs,source:{originalSource:`{
  args: {
    size: 'md',
    placeholder: 'Medium input'
  }
}`,...(G=(_=p.parameters)==null?void 0:_.docs)==null?void 0:G.source}}};var J,K,Q;i.parameters={...i.parameters,docs:{...(J=i.parameters)==null?void 0:J.docs,source:{originalSource:`{
  args: {
    size: 'lg',
    placeholder: 'Large input'
  }
}`,...(Q=(K=i.parameters)==null?void 0:K.docs)==null?void 0:Q.source}}};var X,Z,$;u.parameters={...u.parameters,docs:{...(X=u.parameters)==null?void 0:X.docs,source:{originalSource:`{
  args: {
    disabled: true,
    placeholder: 'Disabled input',
    defaultValue: 'Cannot edit'
  }
}`,...($=(Z=u.parameters)==null?void 0:Z.docs)==null?void 0:$.source}}};var ee,re,ae;m.parameters={...m.parameters,docs:{...(ee=m.parameters)==null?void 0:ee.docs,source:{originalSource:`{
  args: {
    fullWidth: true,
    label: 'Full Width Input',
    placeholder: 'Takes full container width'
  },
  parameters: {
    layout: 'padded'
  }
}`,...(ae=(re=m.parameters)==null?void 0:re.docs)==null?void 0:ae.source}}};var se,te,oe;h.parameters={...h.parameters,docs:{...(se=h.parameters)==null?void 0:se.docs,source:{originalSource:`{
  args: {
    leftElement: <SearchIcon />,
    placeholder: 'Search...'
  }
}`,...(oe=(te=h.parameters)==null?void 0:te.docs)==null?void 0:oe.source}}};var le,ne,de;g.parameters={...g.parameters,docs:{...(le=g.parameters)==null?void 0:le.docs,source:{originalSource:`{
  args: {
    label: 'Amount',
    placeholder: '0.00',
    rightElement: <CurrencyBadge />,
    type: 'number'
  }
}`,...(de=(ne=g.parameters)==null?void 0:ne.docs)==null?void 0:de.source}}};var ce,pe,ie;b.parameters={...b.parameters,docs:{...(ce=b.parameters)==null?void 0:ce.docs,source:{originalSource:`{
  args: {
    placeholder: 'Search tokens, wallets, or paste address...',
    leftElement: <SearchIcon />,
    size: 'lg',
    fullWidth: true
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story: 'Used in the header for searching tokens and wallets.'
      }
    }
  }
}`,...(ie=(pe=b.parameters)==null?void 0:pe.docs)==null?void 0:ie.source}}};var ue,me,he;f.parameters={...f.parameters,docs:{...(ue=f.parameters)==null?void 0:ue.docs,source:{originalSource:`{
  args: {
    label: 'You Pay',
    placeholder: '0.00',
    type: 'number',
    rightElement: <CurrencyBadge />,
    helperText: 'Balance: 10.5 SOL',
    fullWidth: true
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story: 'Used in the swap widget for entering trade amounts.'
      }
    }
  }
}`,...(he=(me=f.parameters)==null?void 0:me.docs)==null?void 0:he.source}}};var ge,be,fe;x.parameters={...x.parameters,docs:{...(ge=x.parameters)==null?void 0:ge.docs,source:{originalSource:`{
  render: () => <div style={{
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    width: '320px'
  }}>\r
      <Input label="Default" placeholder="Enter text..." />\r
      <Input label="With Helper" placeholder="Enter..." helperText="This is helper text" />\r
      <Input label="With Error" placeholder="Enter..." error="This field is required" />\r
      <Input label="Password" type="password" placeholder="Enter password..." />\r
      <Input placeholder="Search..." leftElement={<SearchIcon />} />\r
      <Input label="Amount" type="number" placeholder="0.00" rightElement={<CurrencyBadge />} />\r
      <Input label="Disabled" disabled defaultValue="Cannot edit" />\r
    </div>,
  parameters: {
    docs: {
      description: {
        story: 'Overview of all input variants and states.'
      }
    }
  }
}`,...(fe=(be=x.parameters)==null?void 0:be.docs)==null?void 0:fe.source}}};const je=["Default","WithLabel","WithHelperText","WithError","Password","Number","Search","Small","Medium","Large","Disabled","FullWidth","WithLeftIcon","WithRightElement","TokenSearch","AmountInput","AllVariants"];export{x as AllVariants,f as AmountInput,a as Default,u as Disabled,m as FullWidth,i as Large,p as Medium,n as Number,l as Password,d as Search,c as Small,b as TokenSearch,o as WithError,t as WithHelperText,s as WithLabel,h as WithLeftIcon,g as WithRightElement,je as __namedExportsOrder,Ie as default};
