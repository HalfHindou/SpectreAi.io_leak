import{j as e}from"./jsx-runtime-DF2Pcvd1.js";import{fn as fe}from"./index-CLEdRh-S.js";import{B as r}from"./Button-CYFESGiu.js";import"./index-B2-qRKKC.js";import"./_commonjsHelpers-Cpj98o6Y.js";const je={title:"Components/Button",component:r,parameters:{layout:"centered",docs:{description:{component:`
The Button component is the primary interactive element for user actions in the Spectre AI ecosystem.

## Usage Guidelines

- **Primary**: Use for main actions like "Submit", "Confirm", "Deposit"
- **Secondary**: Use for alternative actions like "Cancel", "Back"
- **Ghost**: Use for tertiary actions or within dense UIs
- **Danger**: Use for destructive actions like "Delete", "Disconnect"
- **Success**: Use for positive confirmations like "Approve", "Confirm Trade"

## Accessibility

- All buttons have proper focus states with visible focus rings
- Loading states include \`aria-busy\` attribute
- Disabled states properly communicate to assistive technologies
        `}}},tags:["autodocs"],argTypes:{variant:{control:"select",options:["primary","secondary","ghost","danger","success"],description:"The visual style of the button",table:{defaultValue:{summary:"primary"}}},size:{control:"select",options:["sm","md","lg"],description:"The size of the button",table:{defaultValue:{summary:"md"}}},isLoading:{control:"boolean",description:"Shows a loading spinner"},fullWidth:{control:"boolean",description:"Makes the button take full width"},disabled:{control:"boolean",description:"Disables the button"}},args:{onClick:fe()}},s={args:{variant:"primary",children:"Primary Button"}},a={args:{variant:"secondary",children:"Secondary Button"}},t={args:{variant:"ghost",children:"Ghost Button"}},n={args:{variant:"danger",children:"Delete"}},o={args:{variant:"success",children:"Confirm Trade"}},i={args:{size:"sm",children:"Small Button"}},c={args:{size:"md",children:"Medium Button"}},d={args:{size:"lg",children:"Large Button"}},l={args:{isLoading:!0,children:"Loading..."}},u={args:{disabled:!0,children:"Disabled Button"}},p={args:{fullWidth:!0,children:"Full Width Button"},parameters:{layout:"padded"}},ye=()=>e.jsx("svg",{viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:e.jsx("path",{d:"M12 5v14M5 12h14"})}),ve=()=>e.jsx("svg",{viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:e.jsx("path",{d:"M5 12h14M12 5l7 7-7 7"})}),m={args:{leftIcon:e.jsx(ye,{}),children:"Add Token"}},g={args:{rightIcon:e.jsx(ve,{}),children:"Continue"}},h={args:{leftIcon:e.jsx(ye,{}),rightIcon:e.jsx(ve,{}),children:"Swap"}},y={args:{variant:"success",size:"lg",children:"Buy SOL",fullWidth:!0},parameters:{layout:"padded",docs:{description:{story:"Used in the trading panel for buy actions."}}}},v={args:{variant:"danger",size:"lg",children:"Sell SOL",fullWidth:!0},parameters:{layout:"padded",docs:{description:{story:"Used in the trading panel for sell actions."}}}},f={render:()=>e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:"24px"},children:[e.jsxs("div",{style:{display:"flex",gap:"16px",alignItems:"center"},children:[e.jsx(r,{variant:"primary",children:"Primary"}),e.jsx(r,{variant:"secondary",children:"Secondary"}),e.jsx(r,{variant:"ghost",children:"Ghost"}),e.jsx(r,{variant:"danger",children:"Danger"}),e.jsx(r,{variant:"success",children:"Success"})]}),e.jsxs("div",{style:{display:"flex",gap:"16px",alignItems:"center"},children:[e.jsx(r,{size:"sm",children:"Small"}),e.jsx(r,{size:"md",children:"Medium"}),e.jsx(r,{size:"lg",children:"Large"})]}),e.jsxs("div",{style:{display:"flex",gap:"16px",alignItems:"center"},children:[e.jsx(r,{isLoading:!0,children:"Loading"}),e.jsx(r,{disabled:!0,children:"Disabled"})]})]}),parameters:{docs:{description:{story:"Overview of all button variants, sizes, and states."}}}};var B,S,x;s.parameters={...s.parameters,docs:{...(B=s.parameters)==null?void 0:B.docs,source:{originalSource:`{
  args: {
    variant: 'primary',
    children: 'Primary Button'
  }
}`,...(x=(S=s.parameters)==null?void 0:S.docs)==null?void 0:x.source}}};var b,I,j;a.parameters={...a.parameters,docs:{...(b=a.parameters)==null?void 0:b.docs,source:{originalSource:`{
  args: {
    variant: 'secondary',
    children: 'Secondary Button'
  }
}`,...(j=(I=a.parameters)==null?void 0:I.docs)==null?void 0:j.source}}};var L,z,D;t.parameters={...t.parameters,docs:{...(L=t.parameters)==null?void 0:L.docs,source:{originalSource:`{
  args: {
    variant: 'ghost',
    children: 'Ghost Button'
  }
}`,...(D=(z=t.parameters)==null?void 0:z.docs)==null?void 0:D.source}}};var W,k,w;n.parameters={...n.parameters,docs:{...(W=n.parameters)==null?void 0:W.docs,source:{originalSource:`{
  args: {
    variant: 'danger',
    children: 'Delete'
  }
}`,...(w=(k=n.parameters)==null?void 0:k.docs)==null?void 0:w.source}}};var A,C,M;o.parameters={...o.parameters,docs:{...(A=o.parameters)==null?void 0:A.docs,source:{originalSource:`{
  args: {
    variant: 'success',
    children: 'Confirm Trade'
  }
}`,...(M=(C=o.parameters)==null?void 0:C.docs)==null?void 0:M.source}}};var U,P,T;i.parameters={...i.parameters,docs:{...(U=i.parameters)==null?void 0:U.docs,source:{originalSource:`{
  args: {
    size: 'sm',
    children: 'Small Button'
  }
}`,...(T=(P=i.parameters)==null?void 0:P.docs)==null?void 0:T.source}}};var G,O,F;c.parameters={...c.parameters,docs:{...(G=c.parameters)==null?void 0:G.docs,source:{originalSource:`{
  args: {
    size: 'md',
    children: 'Medium Button'
  }
}`,...(F=(O=c.parameters)==null?void 0:O.docs)==null?void 0:F.source}}};var V,R,E;d.parameters={...d.parameters,docs:{...(V=d.parameters)==null?void 0:V.docs,source:{originalSource:`{
  args: {
    size: 'lg',
    children: 'Large Button'
  }
}`,...(E=(R=d.parameters)==null?void 0:R.docs)==null?void 0:E.source}}};var _,q,H;l.parameters={...l.parameters,docs:{...(_=l.parameters)==null?void 0:_.docs,source:{originalSource:`{
  args: {
    isLoading: true,
    children: 'Loading...'
  }
}`,...(H=(q=l.parameters)==null?void 0:q.docs)==null?void 0:H.source}}};var J,K,N;u.parameters={...u.parameters,docs:{...(J=u.parameters)==null?void 0:J.docs,source:{originalSource:`{
  args: {
    disabled: true,
    children: 'Disabled Button'
  }
}`,...(N=(K=u.parameters)==null?void 0:K.docs)==null?void 0:N.source}}};var Q,X,Y;p.parameters={...p.parameters,docs:{...(Q=p.parameters)==null?void 0:Q.docs,source:{originalSource:`{
  args: {
    fullWidth: true,
    children: 'Full Width Button'
  },
  parameters: {
    layout: 'padded'
  }
}`,...(Y=(X=p.parameters)==null?void 0:X.docs)==null?void 0:Y.source}}};var Z,$,ee;m.parameters={...m.parameters,docs:{...(Z=m.parameters)==null?void 0:Z.docs,source:{originalSource:`{
  args: {
    leftIcon: <PlusIcon />,
    children: 'Add Token'
  }
}`,...(ee=($=m.parameters)==null?void 0:$.docs)==null?void 0:ee.source}}};var re,se,ae;g.parameters={...g.parameters,docs:{...(re=g.parameters)==null?void 0:re.docs,source:{originalSource:`{
  args: {
    rightIcon: <ArrowIcon />,
    children: 'Continue'
  }
}`,...(ae=(se=g.parameters)==null?void 0:se.docs)==null?void 0:ae.source}}};var te,ne,oe;h.parameters={...h.parameters,docs:{...(te=h.parameters)==null?void 0:te.docs,source:{originalSource:`{
  args: {
    leftIcon: <PlusIcon />,
    rightIcon: <ArrowIcon />,
    children: 'Swap'
  }
}`,...(oe=(ne=h.parameters)==null?void 0:ne.docs)==null?void 0:oe.source}}};var ie,ce,de;y.parameters={...y.parameters,docs:{...(ie=y.parameters)==null?void 0:ie.docs,source:{originalSource:`{
  args: {
    variant: 'success',
    size: 'lg',
    children: 'Buy SOL',
    fullWidth: true
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story: 'Used in the trading panel for buy actions.'
      }
    }
  }
}`,...(de=(ce=y.parameters)==null?void 0:ce.docs)==null?void 0:de.source}}};var le,ue,pe;v.parameters={...v.parameters,docs:{...(le=v.parameters)==null?void 0:le.docs,source:{originalSource:`{
  args: {
    variant: 'danger',
    size: 'lg',
    children: 'Sell SOL',
    fullWidth: true
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story: 'Used in the trading panel for sell actions.'
      }
    }
  }
}`,...(pe=(ue=v.parameters)==null?void 0:ue.docs)==null?void 0:pe.source}}};var me,ge,he;f.parameters={...f.parameters,docs:{...(me=f.parameters)==null?void 0:me.docs,source:{originalSource:`{
  render: () => <div style={{
    display: 'flex',
    flexDirection: 'column',
    gap: '24px'
  }}>\r
      <div style={{
      display: 'flex',
      gap: '16px',
      alignItems: 'center'
    }}>\r
        <Button variant="primary">Primary</Button>\r
        <Button variant="secondary">Secondary</Button>\r
        <Button variant="ghost">Ghost</Button>\r
        <Button variant="danger">Danger</Button>\r
        <Button variant="success">Success</Button>\r
      </div>\r
      <div style={{
      display: 'flex',
      gap: '16px',
      alignItems: 'center'
    }}>\r
        <Button size="sm">Small</Button>\r
        <Button size="md">Medium</Button>\r
        <Button size="lg">Large</Button>\r
      </div>\r
      <div style={{
      display: 'flex',
      gap: '16px',
      alignItems: 'center'
    }}>\r
        <Button isLoading>Loading</Button>\r
        <Button disabled>Disabled</Button>\r
      </div>\r
    </div>,
  parameters: {
    docs: {
      description: {
        story: 'Overview of all button variants, sizes, and states.'
      }
    }
  }
}`,...(he=(ge=f.parameters)==null?void 0:ge.docs)==null?void 0:he.source}}};const Le=["Primary","Secondary","Ghost","Danger","Success","Small","Medium","Large","Loading","Disabled","FullWidth","WithLeftIcon","WithRightIcon","WithBothIcons","BuyButton","SellButton","AllVariants"];export{f as AllVariants,y as BuyButton,n as Danger,u as Disabled,p as FullWidth,t as Ghost,d as Large,l as Loading,c as Medium,s as Primary,a as Secondary,v as SellButton,i as Small,o as Success,h as WithBothIcons,m as WithLeftIcon,g as WithRightIcon,Le as __namedExportsOrder,je as default};
