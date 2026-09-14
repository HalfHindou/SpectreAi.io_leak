import{j as e}from"./jsx-runtime-DF2Pcvd1.js";import{B as h}from"./Button-CYFESGiu.js";import{B as M}from"./Badge-De129EQa.js";import"./index-B2-qRKKC.js";import"./_commonjsHelpers-Cpj98o6Y.js";function r({children:c,variant:H="default",header:p,footer:m,hoverable:I=!1,padding:O=!0,className:A="",...q}){const D=["spectre-card",`spectre-card--${H}`,I&&"spectre-card--hoverable",A].filter(Boolean).join(" ");return e.jsxs("div",{className:D,...q,children:[p&&e.jsx("div",{className:"spectre-card-header",children:p}),e.jsx("div",{className:`spectre-card-content ${O?"":"spectre-card-content--no-padding"}`,children:c}),m&&e.jsx("div",{className:"spectre-card-footer",children:m})]})}try{r.displayName="Card",r.__docgenInfo={description:"Card component for grouping related content.",displayName:"Card",props:{children:{defaultValue:null,description:"The content of the card",name:"children",required:!0,type:{name:"ReactNode"}},variant:{defaultValue:{value:"default"},description:"The visual variant",name:"variant",required:!1,type:{name:"enum",value:[{value:'"default"'},{value:'"elevated"'},{value:'"glass"'},{value:'"outlined"'}]}},header:{defaultValue:null,description:"Card header content",name:"header",required:!1,type:{name:"ReactNode"}},footer:{defaultValue:null,description:"Card footer content",name:"footer",required:!1,type:{name:"ReactNode"}},hoverable:{defaultValue:{value:"false"},description:"Whether the card has a hover effect",name:"hoverable",required:!1,type:{name:"boolean"}},padding:{defaultValue:{value:"true"},description:"Whether the card has padding",name:"padding",required:!1,type:{name:"boolean"}},className:{defaultValue:{value:""},description:"Custom class name",name:"className",required:!1,type:{name:"string"}}}}}catch{}const U={title:"Components/Card",component:r,parameters:{layout:"centered",docs:{description:{component:`
Cards are containers for grouping related content and actions.

## Variants

- **Default**: Standard card with subtle border
- **Elevated**: Raised card with shadow
- **Glass**: Glassmorphism effect with backdrop blur
- **Outlined**: Transparent background with border

## Features

- Optional header and footer sections
- Hoverable state for interactive cards
- Customizable padding
        `}}},tags:["autodocs"],argTypes:{variant:{control:"select",options:["default","elevated","glass","outlined"]},hoverable:{control:"boolean"},padding:{control:"boolean"}}},t={args:{children:e.jsxs("div",{children:[e.jsx("h3",{style:{margin:"0 0 8px",fontSize:"16px"},children:"Card Title"}),e.jsx("p",{style:{margin:0,color:"var(--spectre-text-secondary)"},children:"This is some card content. Cards are used to group related information."})]})}},a={args:{variant:"elevated",children:e.jsxs("div",{children:[e.jsx("h3",{style:{margin:"0 0 8px",fontSize:"16px"},children:"Elevated Card"}),e.jsx("p",{style:{margin:0,color:"var(--spectre-text-secondary)"},children:"This card has a shadow for more emphasis."})]})}},n={args:{variant:"glass",children:e.jsxs("div",{children:[e.jsx("h3",{style:{margin:"0 0 8px",fontSize:"16px"},children:"Glass Card"}),e.jsx("p",{style:{margin:0,color:"var(--spectre-text-secondary)"},children:"Glassmorphism effect with backdrop blur."})]})},parameters:{backgrounds:{default:"spectre-surface"}}},s={args:{variant:"outlined",children:e.jsxs("div",{children:[e.jsx("h3",{style:{margin:"0 0 8px",fontSize:"16px"},children:"Outlined Card"}),e.jsx("p",{style:{margin:0,color:"var(--spectre-text-secondary)"},children:"Transparent background with border only."})]})}},i={args:{header:e.jsx("span",{children:"Token Stats"}),children:e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:"12px"},children:[e.jsxs("div",{style:{display:"flex",justifyContent:"space-between"},children:[e.jsx("span",{style:{color:"var(--spectre-text-tertiary)"},children:"Market Cap"}),e.jsx("span",{style:{fontFamily:"var(--spectre-font-mono)"},children:"$1.2M"})]}),e.jsxs("div",{style:{display:"flex",justifyContent:"space-between"},children:[e.jsx("span",{style:{color:"var(--spectre-text-tertiary)"},children:"24h Volume"}),e.jsx("span",{style:{fontFamily:"var(--spectre-font-mono)"},children:"$234K"})]}),e.jsxs("div",{style:{display:"flex",justifyContent:"space-between"},children:[e.jsx("span",{style:{color:"var(--spectre-text-tertiary)"},children:"Holders"}),e.jsx("span",{style:{fontFamily:"var(--spectre-font-mono)"},children:"1,234"})]})]})}},l={args:{header:e.jsx("span",{children:"SPECTRE"}),children:e.jsxs("div",{style:{textAlign:"center",padding:"20px 0"},children:[e.jsx("div",{style:{fontSize:"32px",fontFamily:"var(--spectre-font-mono)",fontWeight:600,marginBottom:"8px"},children:"$0.00234"}),e.jsx("div",{style:{color:"var(--spectre-bull)",fontSize:"14px"},children:"↑ +12.45%"})]}),footer:e.jsxs("div",{style:{display:"flex",gap:"8px"},children:[e.jsx(h,{variant:"success",size:"sm",fullWidth:!0,children:"Buy"}),e.jsx(h,{variant:"danger",size:"sm",fullWidth:!0,children:"Sell"})]})}},o={args:{hoverable:!0,children:e.jsxs("div",{style:{display:"flex",alignItems:"center",gap:"16px"},children:[e.jsx("div",{style:{width:"48px",height:"48px",borderRadius:"12px",background:"var(--spectre-accent-gradient)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"24px"},children:"👻"}),e.jsxs("div",{children:[e.jsxs("div",{style:{display:"flex",alignItems:"center",gap:"8px",marginBottom:"4px"},children:[e.jsx("span",{style:{fontWeight:600},children:"SPECTRE"}),e.jsx(M,{variant:"success",size:"sm",children:"Verified"})]}),e.jsx("div",{style:{color:"var(--spectre-text-tertiary)",fontSize:"14px"},children:"Spectre AI Token"})]}),e.jsxs("div",{style:{marginLeft:"auto",textAlign:"right"},children:[e.jsx("div",{style:{fontFamily:"var(--spectre-font-mono)",fontWeight:600},children:"$0.00234"}),e.jsx("div",{style:{color:"var(--spectre-bull)",fontSize:"14px"},children:"+12.45%"})]})]})},parameters:{docs:{description:{story:"Hoverable cards are great for clickable items like token lists."}}}},d={render:()=>e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"repeat(2, 1fr)",gap:"16px",width:"600px"},children:[e.jsxs(r,{variant:"default",children:[e.jsx("h4",{style:{margin:"0 0 8px"},children:"Default"}),e.jsx("p",{style:{margin:0,color:"var(--spectre-text-tertiary)",fontSize:"14px"},children:"Standard card style"})]}),e.jsxs(r,{variant:"elevated",children:[e.jsx("h4",{style:{margin:"0 0 8px"},children:"Elevated"}),e.jsx("p",{style:{margin:0,color:"var(--spectre-text-tertiary)",fontSize:"14px"},children:"With shadow"})]}),e.jsxs(r,{variant:"glass",children:[e.jsx("h4",{style:{margin:"0 0 8px"},children:"Glass"}),e.jsx("p",{style:{margin:0,color:"var(--spectre-text-tertiary)",fontSize:"14px"},children:"Backdrop blur effect"})]}),e.jsxs(r,{variant:"outlined",children:[e.jsx("h4",{style:{margin:"0 0 8px"},children:"Outlined"}),e.jsx("p",{style:{margin:0,color:"var(--spectre-text-tertiary)",fontSize:"14px"},children:"Border only"})]})]})};var x,v,y;t.parameters={...t.parameters,docs:{...(x=t.parameters)==null?void 0:x.docs,source:{originalSource:`{
  args: {
    children: <div>\r
        <h3 style={{
        margin: '0 0 8px',
        fontSize: '16px'
      }}>Card Title</h3>\r
        <p style={{
        margin: 0,
        color: 'var(--spectre-text-secondary)'
      }}>\r
          This is some card content. Cards are used to group related information.\r
        </p>\r
      </div>
  }
}`,...(y=(v=t.parameters)==null?void 0:v.docs)==null?void 0:y.source}}};var u,f,g;a.parameters={...a.parameters,docs:{...(u=a.parameters)==null?void 0:u.docs,source:{originalSource:`{
  args: {
    variant: 'elevated',
    children: <div>\r
        <h3 style={{
        margin: '0 0 8px',
        fontSize: '16px'
      }}>Elevated Card</h3>\r
        <p style={{
        margin: 0,
        color: 'var(--spectre-text-secondary)'
      }}>\r
          This card has a shadow for more emphasis.\r
        </p>\r
      </div>
  }
}`,...(g=(f=a.parameters)==null?void 0:f.docs)==null?void 0:g.source}}};var j,b,S;n.parameters={...n.parameters,docs:{...(j=n.parameters)==null?void 0:j.docs,source:{originalSource:`{
  args: {
    variant: 'glass',
    children: <div>\r
        <h3 style={{
        margin: '0 0 8px',
        fontSize: '16px'
      }}>Glass Card</h3>\r
        <p style={{
        margin: 0,
        color: 'var(--spectre-text-secondary)'
      }}>\r
          Glassmorphism effect with backdrop blur.\r
        </p>\r
      </div>
  },
  parameters: {
    backgrounds: {
      default: 'spectre-surface'
    }
  }
}`,...(S=(b=n.parameters)==null?void 0:b.docs)==null?void 0:S.source}}};var C,z,k;s.parameters={...s.parameters,docs:{...(C=s.parameters)==null?void 0:C.docs,source:{originalSource:`{
  args: {
    variant: 'outlined',
    children: <div>\r
        <h3 style={{
        margin: '0 0 8px',
        fontSize: '16px'
      }}>Outlined Card</h3>\r
        <p style={{
        margin: 0,
        color: 'var(--spectre-text-secondary)'
      }}>\r
          Transparent background with border only.\r
        </p>\r
      </div>
  }
}`,...(k=(z=s.parameters)==null?void 0:z.docs)==null?void 0:k.source}}};var w,T,B;i.parameters={...i.parameters,docs:{...(w=i.parameters)==null?void 0:w.docs,source:{originalSource:`{
  args: {
    header: <span>Token Stats</span>,
    children: <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }}>\r
        <div style={{
        display: 'flex',
        justifyContent: 'space-between'
      }}>\r
          <span style={{
          color: 'var(--spectre-text-tertiary)'
        }}>Market Cap</span>\r
          <span style={{
          fontFamily: 'var(--spectre-font-mono)'
        }}>$1.2M</span>\r
        </div>\r
        <div style={{
        display: 'flex',
        justifyContent: 'space-between'
      }}>\r
          <span style={{
          color: 'var(--spectre-text-tertiary)'
        }}>24h Volume</span>\r
          <span style={{
          fontFamily: 'var(--spectre-font-mono)'
        }}>$234K</span>\r
        </div>\r
        <div style={{
        display: 'flex',
        justifyContent: 'space-between'
      }}>\r
          <span style={{
          color: 'var(--spectre-text-tertiary)'
        }}>Holders</span>\r
          <span style={{
          fontFamily: 'var(--spectre-font-mono)'
        }}>1,234</span>\r
        </div>\r
      </div>
  }
}`,...(B=(T=i.parameters)==null?void 0:T.docs)==null?void 0:B.source}}};var W,E,V;l.parameters={...l.parameters,docs:{...(W=l.parameters)==null?void 0:W.docs,source:{originalSource:`{
  args: {
    header: <span>SPECTRE</span>,
    children: <div style={{
      textAlign: 'center',
      padding: '20px 0'
    }}>\r
        <div style={{
        fontSize: '32px',
        fontFamily: 'var(--spectre-font-mono)',
        fontWeight: 600,
        marginBottom: '8px'
      }}>\r
          $0.00234\r
        </div>\r
        <div style={{
        color: 'var(--spectre-bull)',
        fontSize: '14px'
      }}>\r
          ↑ +12.45%\r
        </div>\r
      </div>,
    footer: <div style={{
      display: 'flex',
      gap: '8px'
    }}>\r
        <Button variant="success" size="sm" fullWidth>Buy</Button>\r
        <Button variant="danger" size="sm" fullWidth>Sell</Button>\r
      </div>
  }
}`,...(V=(E=l.parameters)==null?void 0:E.docs)==null?void 0:V.source}}};var F,N,R;o.parameters={...o.parameters,docs:{...(F=o.parameters)==null?void 0:F.docs,source:{originalSource:`{
  args: {
    hoverable: true,
    children: <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '16px'
    }}>\r
        <div style={{
        width: '48px',
        height: '48px',
        borderRadius: '12px',
        background: 'var(--spectre-accent-gradient)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '24px'
      }}>\r
          👻\r
        </div>\r
        <div>\r
          <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '4px'
        }}>\r
            <span style={{
            fontWeight: 600
          }}>SPECTRE</span>\r
            <Badge variant="success" size="sm">Verified</Badge>\r
          </div>\r
          <div style={{
          color: 'var(--spectre-text-tertiary)',
          fontSize: '14px'
        }}>\r
            Spectre AI Token\r
          </div>\r
        </div>\r
        <div style={{
        marginLeft: 'auto',
        textAlign: 'right'
      }}>\r
          <div style={{
          fontFamily: 'var(--spectre-font-mono)',
          fontWeight: 600
        }}>$0.00234</div>\r
          <div style={{
          color: 'var(--spectre-bull)',
          fontSize: '14px'
        }}>+12.45%</div>\r
        </div>\r
      </div>
  },
  parameters: {
    docs: {
      description: {
        story: 'Hoverable cards are great for clickable items like token lists.'
      }
    }
  }
}`,...(R=(N=o.parameters)==null?void 0:N.docs)==null?void 0:R.source}}};var G,_,$;d.parameters={...d.parameters,docs:{...(G=d.parameters)==null?void 0:G.docs,source:{originalSource:`{
  render: () => <div style={{
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '16px',
    width: '600px'
  }}>\r
      <Card variant="default">\r
        <h4 style={{
        margin: '0 0 8px'
      }}>Default</h4>\r
        <p style={{
        margin: 0,
        color: 'var(--spectre-text-tertiary)',
        fontSize: '14px'
      }}>\r
          Standard card style\r
        </p>\r
      </Card>\r
      <Card variant="elevated">\r
        <h4 style={{
        margin: '0 0 8px'
      }}>Elevated</h4>\r
        <p style={{
        margin: 0,
        color: 'var(--spectre-text-tertiary)',
        fontSize: '14px'
      }}>\r
          With shadow\r
        </p>\r
      </Card>\r
      <Card variant="glass">\r
        <h4 style={{
        margin: '0 0 8px'
      }}>Glass</h4>\r
        <p style={{
        margin: 0,
        color: 'var(--spectre-text-tertiary)',
        fontSize: '14px'
      }}>\r
          Backdrop blur effect\r
        </p>\r
      </Card>\r
      <Card variant="outlined">\r
        <h4 style={{
        margin: '0 0 8px'
      }}>Outlined</h4>\r
        <p style={{
        margin: 0,
        color: 'var(--spectre-text-tertiary)',
        fontSize: '14px'
      }}>\r
          Border only\r
        </p>\r
      </Card>\r
    </div>
}`,...($=(_=d.parameters)==null?void 0:_.docs)==null?void 0:$.source}}};const X=["Default","Elevated","Glass","Outlined","WithHeader","WithFooter","Hoverable","AllVariants"];export{d as AllVariants,t as Default,a as Elevated,n as Glass,o as Hoverable,s as Outlined,l as WithFooter,i as WithHeader,X as __namedExportsOrder,U as default};
