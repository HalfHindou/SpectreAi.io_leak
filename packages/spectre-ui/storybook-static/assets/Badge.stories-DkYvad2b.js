import{j as e}from"./jsx-runtime-DF2Pcvd1.js";import{B as r}from"./Badge-De129EQa.js";import"./index-B2-qRKKC.js";import"./_commonjsHelpers-Cpj98o6Y.js";const q={title:"Components/Badge",component:r,parameters:{layout:"centered",docs:{description:{component:`
Badges are used for status indicators, labels, and categorization.

## Usage Guidelines

- **Default**: Neutral labels, counts, metadata
- **Accent**: Featured items, highlights
- **Success**: Verified, safe, positive states
- **Danger**: Warnings, high risk, errors
- **Warning**: Caution, attention needed
- **Info**: Informational, trending

## Trading Use Cases

- Token verification status
- Risk level indicators
- Trending/new listings
- Price change direction
        `}}},tags:["autodocs"],argTypes:{variant:{control:"select",options:["default","accent","success","danger","warning","info"]},size:{control:"select",options:["sm","md"]},dot:{control:"boolean"}}},a={args:{children:"Default"}},s={args:{variant:"accent",children:"Featured"}},n={args:{variant:"success",children:"Verified"}},i={args:{variant:"danger",children:"High Risk"}},t={args:{variant:"warning",children:"Trending"}},d={args:{variant:"info",children:"New"}},c={args:{variant:"success",children:"Live",dot:!0}},o={args:{size:"sm",children:"Small"}},l={render:()=>e.jsxs("div",{style:{display:"flex",flexWrap:"wrap",gap:"12px",alignItems:"center"},children:[e.jsx(r,{children:"Default"}),e.jsx(r,{variant:"accent",children:"Featured"}),e.jsx(r,{variant:"success",children:"Verified"}),e.jsx(r,{variant:"danger",children:"High Risk"}),e.jsx(r,{variant:"warning",children:"Trending"}),e.jsx(r,{variant:"info",children:"New"})]})},g={render:()=>e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:"24px"},children:[e.jsxs("div",{children:[e.jsx("h4",{style:{color:"var(--spectre-text-secondary)",marginBottom:"12px",fontSize:"14px"},children:"Token Status"}),e.jsxs("div",{style:{display:"flex",gap:"8px",flexWrap:"wrap"},children:[e.jsx(r,{variant:"success",children:"Verified"}),e.jsx(r,{variant:"accent",children:"Featured"}),e.jsx(r,{variant:"warning",children:"New Listing"})]})]}),e.jsxs("div",{children:[e.jsx("h4",{style:{color:"var(--spectre-text-secondary)",marginBottom:"12px",fontSize:"14px"},children:"Risk Levels"}),e.jsxs("div",{style:{display:"flex",gap:"8px",flexWrap:"wrap"},children:[e.jsx(r,{variant:"success",children:"Low Risk"}),e.jsx(r,{variant:"warning",children:"Medium Risk"}),e.jsx(r,{variant:"danger",children:"High Risk"})]})]}),e.jsxs("div",{children:[e.jsx("h4",{style:{color:"var(--spectre-text-secondary)",marginBottom:"12px",fontSize:"14px"},children:"Live Status"}),e.jsxs("div",{style:{display:"flex",gap:"8px",flexWrap:"wrap"},children:[e.jsx(r,{variant:"success",dot:!0,children:"Live"}),e.jsx(r,{variant:"info",dot:!0,children:"Updating"}),e.jsx(r,{variant:"default",children:"Offline"})]})]})]}),parameters:{docs:{description:{story:"Common badge patterns used in the trading platform."}}}};var p,m,u;a.parameters={...a.parameters,docs:{...(p=a.parameters)==null?void 0:p.docs,source:{originalSource:`{
  args: {
    children: 'Default'
  }
}`,...(u=(m=a.parameters)==null?void 0:m.docs)==null?void 0:u.source}}};var v,x,h;s.parameters={...s.parameters,docs:{...(v=s.parameters)==null?void 0:v.docs,source:{originalSource:`{
  args: {
    variant: 'accent',
    children: 'Featured'
  }
}`,...(h=(x=s.parameters)==null?void 0:x.docs)==null?void 0:h.source}}};var f,B,y;n.parameters={...n.parameters,docs:{...(f=n.parameters)==null?void 0:f.docs,source:{originalSource:`{
  args: {
    variant: 'success',
    children: 'Verified'
  }
}`,...(y=(B=n.parameters)==null?void 0:B.docs)==null?void 0:y.source}}};var j,S,w;i.parameters={...i.parameters,docs:{...(j=i.parameters)==null?void 0:j.docs,source:{originalSource:`{
  args: {
    variant: 'danger',
    children: 'High Risk'
  }
}`,...(w=(S=i.parameters)==null?void 0:S.docs)==null?void 0:w.source}}};var k,D,R;t.parameters={...t.parameters,docs:{...(k=t.parameters)==null?void 0:k.docs,source:{originalSource:`{
  args: {
    variant: 'warning',
    children: 'Trending'
  }
}`,...(R=(D=t.parameters)==null?void 0:D.docs)==null?void 0:R.source}}};var W,L,T;d.parameters={...d.parameters,docs:{...(W=d.parameters)==null?void 0:W.docs,source:{originalSource:`{
  args: {
    variant: 'info',
    children: 'New'
  }
}`,...(T=(L=d.parameters)==null?void 0:L.docs)==null?void 0:T.source}}};var z,V,F;c.parameters={...c.parameters,docs:{...(z=c.parameters)==null?void 0:z.docs,source:{originalSource:`{
  args: {
    variant: 'success',
    children: 'Live',
    dot: true
  }
}`,...(F=(V=c.parameters)==null?void 0:V.docs)==null?void 0:F.source}}};var N,H,I;o.parameters={...o.parameters,docs:{...(N=o.parameters)==null?void 0:N.docs,source:{originalSource:`{
  args: {
    size: 'sm',
    children: 'Small'
  }
}`,...(I=(H=o.parameters)==null?void 0:H.docs)==null?void 0:I.source}}};var b,A,C;l.parameters={...l.parameters,docs:{...(b=l.parameters)==null?void 0:b.docs,source:{originalSource:`{
  render: () => <div style={{
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    alignItems: 'center'
  }}>\r
      <Badge>Default</Badge>\r
      <Badge variant="accent">Featured</Badge>\r
      <Badge variant="success">Verified</Badge>\r
      <Badge variant="danger">High Risk</Badge>\r
      <Badge variant="warning">Trending</Badge>\r
      <Badge variant="info">New</Badge>\r
    </div>
}`,...(C=(A=l.parameters)==null?void 0:A.docs)==null?void 0:C.source}}};var U,O,E;g.parameters={...g.parameters,docs:{...(U=g.parameters)==null?void 0:U.docs,source:{originalSource:`{
  render: () => <div style={{
    display: 'flex',
    flexDirection: 'column',
    gap: '24px'
  }}>\r
      <div>\r
        <h4 style={{
        color: 'var(--spectre-text-secondary)',
        marginBottom: '12px',
        fontSize: '14px'
      }}>\r
          Token Status\r
        </h4>\r
        <div style={{
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap'
      }}>\r
          <Badge variant="success">Verified</Badge>\r
          <Badge variant="accent">Featured</Badge>\r
          <Badge variant="warning">New Listing</Badge>\r
        </div>\r
      </div>\r
      \r
      <div>\r
        <h4 style={{
        color: 'var(--spectre-text-secondary)',
        marginBottom: '12px',
        fontSize: '14px'
      }}>\r
          Risk Levels\r
        </h4>\r
        <div style={{
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap'
      }}>\r
          <Badge variant="success">Low Risk</Badge>\r
          <Badge variant="warning">Medium Risk</Badge>\r
          <Badge variant="danger">High Risk</Badge>\r
        </div>\r
      </div>\r
      \r
      <div>\r
        <h4 style={{
        color: 'var(--spectre-text-secondary)',
        marginBottom: '12px',
        fontSize: '14px'
      }}>\r
          Live Status\r
        </h4>\r
        <div style={{
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap'
      }}>\r
          <Badge variant="success" dot>Live</Badge>\r
          <Badge variant="info" dot>Updating</Badge>\r
          <Badge variant="default">Offline</Badge>\r
        </div>\r
      </div>\r
    </div>,
  parameters: {
    docs: {
      description: {
        story: 'Common badge patterns used in the trading platform.'
      }
    }
  }
}`,...(E=(O=g.parameters)==null?void 0:O.docs)==null?void 0:E.source}}};const J=["Default","Accent","Success","Danger","Warning","Info","WithDot","Small","AllVariants","TradingBadges"];export{s as Accent,l as AllVariants,i as Danger,a as Default,d as Info,o as Small,n as Success,g as TradingBadges,t as Warning,c as WithDot,J as __namedExportsOrder,q as default};
