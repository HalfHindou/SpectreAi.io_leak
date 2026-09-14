import{j as e}from"./jsx-runtime-DF2Pcvd1.js";import"./index-B2-qRKKC.js";import"./_commonjsHelpers-Cpj98o6Y.js";const R={title:"Foundation/Design Tokens",parameters:{docs:{description:{component:`
Design tokens are the foundational visual values of the Spectre design system.
They ensure consistency across all applications in the ecosystem.

## Usage

Import the CSS variables in your app:

\`\`\`tsx
import '@spectre-ai/ui/tokens/variables.css';
\`\`\`

Then use the variables in your CSS:

\`\`\`css
.my-component {
  background: var(--spectre-bg-surface);
  color: var(--spectre-text-primary);
  border-radius: var(--spectre-radius-md);
}
\`\`\`
        `}}},tags:["autodocs"]};function D({name:n,value:r,textColor:a="white"}){return e.jsxs("div",{style:{display:"flex",alignItems:"center",gap:"12px",marginBottom:"8px"},children:[e.jsx("div",{style:{width:"48px",height:"48px",borderRadius:"8px",background:r,border:"1px solid var(--spectre-border-default)",flexShrink:0}}),e.jsxs("div",{children:[e.jsx("code",{style:{color:"var(--spectre-accent)",fontSize:"0.875rem"},children:n}),e.jsx("div",{style:{color:"var(--spectre-text-tertiary)",fontSize:"0.75rem",marginTop:"2px"},children:r})]})]})}function t({title:n,colors:r}){return e.jsxs("div",{style:{marginBottom:"32px"},children:[e.jsx("h3",{style:{marginBottom:"16px",color:"var(--spectre-text-primary)"},children:n}),e.jsx("div",{style:{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(200px, 1fr))",gap:"8px"},children:r.map(a=>e.jsx(D,{name:a.name,value:a.value},a.name))})]})}const s={render:()=>e.jsxs("div",{children:[e.jsx(t,{title:"Brand Accent",colors:[{name:"--spectre-accent",value:"#8B5CF6"},{name:"--spectre-accent-hover",value:"#A78BFA"},{name:"--spectre-accent-secondary",value:"#6366F1"}]}),e.jsx(t,{title:"Backgrounds",colors:[{name:"--spectre-bg-void",value:"#050508"},{name:"--spectre-bg-base",value:"#0a0a0f"},{name:"--spectre-bg-surface",value:"#12121a"},{name:"--spectre-bg-elevated",value:"#1a1a24"}]}),e.jsx(t,{title:"Text",colors:[{name:"--spectre-text-primary",value:"#f4f4f5"},{name:"--spectre-text-secondary",value:"#a1a1aa"},{name:"--spectre-text-tertiary",value:"#71717a"},{name:"--spectre-text-muted",value:"#52525b"}]}),e.jsx(t,{title:"Trading",colors:[{name:"--spectre-bull",value:"#10B981"},{name:"--spectre-bull-bright",value:"#34D399"},{name:"--spectre-bear",value:"#EF4444"},{name:"--spectre-bear-bright",value:"#F87171"}]}),e.jsx(t,{title:"Secondary Accents",colors:[{name:"--spectre-cyan",value:"#22D3EE"},{name:"--spectre-orange",value:"#F97316"},{name:"--spectre-pink",value:"#EC4899"},{name:"--spectre-yellow",value:"#FBBF24"}]})]})},c={render:()=>e.jsxs("div",{children:[e.jsx("h3",{style:{marginBottom:"24px",color:"var(--spectre-text-primary)"},children:"Font Families"}),e.jsxs("div",{style:{marginBottom:"32px"},children:[e.jsxs("p",{style:{fontFamily:"var(--spectre-font-body)",marginBottom:"8px"},children:[e.jsx("strong",{children:"Body:"})," Inter, -apple-system, sans-serif"]}),e.jsxs("p",{style:{fontFamily:"var(--spectre-font-display)",marginBottom:"8px"},children:[e.jsx("strong",{children:"Display:"})," Space Grotesk, Inter, sans-serif"]}),e.jsxs("p",{style:{fontFamily:"var(--spectre-font-mono)"},children:[e.jsx("strong",{children:"Mono:"})," JetBrains Mono, Fira Code, monospace"]})]}),e.jsx("h3",{style:{marginBottom:"24px",color:"var(--spectre-text-primary)"},children:"Type Scale"}),e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:"16px"},children:[e.jsxs("div",{children:[e.jsx("code",{style:{color:"var(--spectre-accent)"},children:"--spectre-text-4xl"}),e.jsx("p",{style:{fontSize:"2.5rem",fontFamily:"var(--spectre-font-display)"},children:"Display XL (40px)"})]}),e.jsxs("div",{children:[e.jsx("code",{style:{color:"var(--spectre-accent)"},children:"--spectre-text-3xl"}),e.jsx("p",{style:{fontSize:"2rem",fontFamily:"var(--spectre-font-display)"},children:"Display LG (32px)"})]}),e.jsxs("div",{children:[e.jsx("code",{style:{color:"var(--spectre-accent)"},children:"--spectre-text-2xl"}),e.jsx("p",{style:{fontSize:"1.5rem"},children:"Display MD (24px)"})]}),e.jsxs("div",{children:[e.jsx("code",{style:{color:"var(--spectre-accent)"},children:"--spectre-text-xl"}),e.jsx("p",{style:{fontSize:"1.125rem"},children:"Heading (18px)"})]}),e.jsxs("div",{children:[e.jsx("code",{style:{color:"var(--spectre-accent)"},children:"--spectre-text-lg"}),e.jsx("p",{style:{fontSize:"1rem"},children:"Large (16px)"})]}),e.jsxs("div",{children:[e.jsx("code",{style:{color:"var(--spectre-accent)"},children:"--spectre-text-md"}),e.jsx("p",{style:{fontSize:"0.875rem"},children:"Medium (14px)"})]}),e.jsxs("div",{children:[e.jsx("code",{style:{color:"var(--spectre-accent)"},children:"--spectre-text-base"}),e.jsx("p",{style:{fontSize:"0.8125rem"},children:"Base (13px)"})]}),e.jsxs("div",{children:[e.jsx("code",{style:{color:"var(--spectre-accent)"},children:"--spectre-text-sm"}),e.jsx("p",{style:{fontSize:"0.75rem"},children:"Small (12px)"})]}),e.jsxs("div",{children:[e.jsx("code",{style:{color:"var(--spectre-accent)"},children:"--spectre-text-xs"}),e.jsx("p",{style:{fontSize:"0.6875rem"},children:"Extra Small (11px)"})]})]})]})},o={render:()=>{const n=[{name:"--spectre-space-1",value:"4px"},{name:"--spectre-space-2",value:"8px"},{name:"--spectre-space-3",value:"12px"},{name:"--spectre-space-4",value:"16px"},{name:"--spectre-space-5",value:"20px"},{name:"--spectre-space-6",value:"24px"},{name:"--spectre-space-8",value:"32px"},{name:"--spectre-space-10",value:"40px"},{name:"--spectre-space-12",value:"48px"},{name:"--spectre-space-16",value:"64px"}];return e.jsxs("div",{children:[e.jsx("h3",{style:{marginBottom:"24px",color:"var(--spectre-text-primary)"},children:"Spacing Scale (4px grid)"}),n.map(r=>e.jsxs("div",{style:{display:"flex",alignItems:"center",gap:"16px",marginBottom:"8px"},children:[e.jsx("div",{style:{width:r.value,height:"24px",background:"var(--spectre-accent)",borderRadius:"4px"}}),e.jsx("code",{style:{color:"var(--spectre-accent)",width:"180px"},children:r.name}),e.jsx("span",{style:{color:"var(--spectre-text-tertiary)"},children:r.value})]},r.name))]})}},p={render:()=>{const n=[{name:"--spectre-radius-sm",value:"4px"},{name:"--spectre-radius-md",value:"8px"},{name:"--spectre-radius-lg",value:"12px"},{name:"--spectre-radius-xl",value:"16px"},{name:"--spectre-radius-2xl",value:"24px"},{name:"--spectre-radius-full",value:"9999px"}];return e.jsxs("div",{children:[e.jsx("h3",{style:{marginBottom:"24px",color:"var(--spectre-text-primary)"},children:"Border Radius"}),e.jsx("div",{style:{display:"flex",flexWrap:"wrap",gap:"24px"},children:n.map(r=>e.jsxs("div",{style:{textAlign:"center"},children:[e.jsx("div",{style:{width:"80px",height:"80px",background:"var(--spectre-accent)",borderRadius:r.value,marginBottom:"8px"}}),e.jsx("code",{style:{color:"var(--spectre-accent)",fontSize:"0.75rem"},children:r.name}),e.jsx("div",{style:{color:"var(--spectre-text-tertiary)",fontSize:"0.75rem"},children:r.value})]},r.name))})]})}},l={render:()=>{const n=[{name:"--spectre-shadow-xs",value:"0 1px 2px rgba(0, 0, 0, 0.5)"},{name:"--spectre-shadow-sm",value:"0 2px 8px rgba(0, 0, 0, 0.6)"},{name:"--spectre-shadow-md",value:"0 4px 16px rgba(0, 0, 0, 0.5)"},{name:"--spectre-shadow-lg",value:"0 8px 32px rgba(0, 0, 0, 0.6)"},{name:"--spectre-shadow-xl",value:"0 16px 48px rgba(0, 0, 0, 0.7)"},{name:"--spectre-shadow-glow",value:"0 0 40px rgba(139, 92, 246, 0.5)"}];return e.jsxs("div",{children:[e.jsx("h3",{style:{marginBottom:"24px",color:"var(--spectre-text-primary)"},children:"Shadows"}),e.jsx("div",{style:{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(150px, 1fr))",gap:"24px"},children:n.map(r=>e.jsxs("div",{style:{textAlign:"center"},children:[e.jsx("div",{style:{width:"100%",height:"80px",background:"var(--spectre-bg-elevated)",borderRadius:"8px",boxShadow:r.value,marginBottom:"12px"}}),e.jsx("code",{style:{color:"var(--spectre-accent)",fontSize:"0.75rem"},children:r.name})]},r.name))})]})}},i={render:()=>e.jsxs("div",{children:[e.jsx("h3",{style:{marginBottom:"24px",color:"var(--spectre-text-primary)"},children:"Animation Tokens"}),e.jsx("h4",{style:{marginBottom:"12px",color:"var(--spectre-text-secondary)"},children:"Durations"}),e.jsxs("div",{style:{marginBottom:"24px"},children:[e.jsxs("div",{children:[e.jsx("code",{style:{color:"var(--spectre-accent)"},children:"--spectre-duration-fast"}),": 150ms"]}),e.jsxs("div",{children:[e.jsx("code",{style:{color:"var(--spectre-accent)"},children:"--spectre-duration-normal"}),": 250ms"]}),e.jsxs("div",{children:[e.jsx("code",{style:{color:"var(--spectre-accent)"},children:"--spectre-duration-slow"}),": 400ms"]})]}),e.jsx("h4",{style:{marginBottom:"12px",color:"var(--spectre-text-secondary)"},children:"Easing Functions"}),e.jsxs("div",{style:{marginBottom:"24px"},children:[e.jsxs("div",{children:[e.jsx("code",{style:{color:"var(--spectre-accent)"},children:"--spectre-easing-default"}),": cubic-bezier(0.4, 0, 0.2, 1)"]}),e.jsxs("div",{children:[e.jsx("code",{style:{color:"var(--spectre-accent)"},children:"--spectre-easing-in"}),": cubic-bezier(0.4, 0, 1, 1)"]}),e.jsxs("div",{children:[e.jsx("code",{style:{color:"var(--spectre-accent)"},children:"--spectre-easing-out"}),": cubic-bezier(0, 0, 0.2, 1)"]}),e.jsxs("div",{children:[e.jsx("code",{style:{color:"var(--spectre-accent)"},children:"--spectre-easing-spring"}),": cubic-bezier(0.34, 1.56, 0.64, 1)"]})]}),e.jsx("h4",{style:{marginBottom:"12px",color:"var(--spectre-text-secondary)"},children:"Example Usage"}),e.jsx("pre",{style:{background:"var(--spectre-bg-elevated)",padding:"16px",borderRadius:"8px",fontSize:"0.875rem",overflow:"auto"},children:`.button {
  transition: all var(--spectre-duration-fast) var(--spectre-easing-default);
}

.modal {
  animation: fadeIn var(--spectre-duration-normal) var(--spectre-easing-spring);
}`})]})};var d,x,m;s.parameters={...s.parameters,docs:{...(d=s.parameters)==null?void 0:d.docs,source:{originalSource:`{
  render: () => <div>\r
      <ColorGroup title="Brand Accent" colors={[{
      name: '--spectre-accent',
      value: '#8B5CF6'
    }, {
      name: '--spectre-accent-hover',
      value: '#A78BFA'
    }, {
      name: '--spectre-accent-secondary',
      value: '#6366F1'
    }]} />\r
      \r
      <ColorGroup title="Backgrounds" colors={[{
      name: '--spectre-bg-void',
      value: '#050508'
    }, {
      name: '--spectre-bg-base',
      value: '#0a0a0f'
    }, {
      name: '--spectre-bg-surface',
      value: '#12121a'
    }, {
      name: '--spectre-bg-elevated',
      value: '#1a1a24'
    }]} />\r
      \r
      <ColorGroup title="Text" colors={[{
      name: '--spectre-text-primary',
      value: '#f4f4f5'
    }, {
      name: '--spectre-text-secondary',
      value: '#a1a1aa'
    }, {
      name: '--spectre-text-tertiary',
      value: '#71717a'
    }, {
      name: '--spectre-text-muted',
      value: '#52525b'
    }]} />\r
      \r
      <ColorGroup title="Trading" colors={[{
      name: '--spectre-bull',
      value: '#10B981'
    }, {
      name: '--spectre-bull-bright',
      value: '#34D399'
    }, {
      name: '--spectre-bear',
      value: '#EF4444'
    }, {
      name: '--spectre-bear-bright',
      value: '#F87171'
    }]} />\r
      \r
      <ColorGroup title="Secondary Accents" colors={[{
      name: '--spectre-cyan',
      value: '#22D3EE'
    }, {
      name: '--spectre-orange',
      value: '#F97316'
    }, {
      name: '--spectre-pink',
      value: '#EC4899'
    }, {
      name: '--spectre-yellow',
      value: '#FBBF24'
    }]} />\r
    </div>
}`,...(m=(x=s.parameters)==null?void 0:x.docs)==null?void 0:m.source}}};var v,u,y;c.parameters={...c.parameters,docs:{...(v=c.parameters)==null?void 0:v.docs,source:{originalSource:`{
  render: () => <div>\r
      <h3 style={{
      marginBottom: '24px',
      color: 'var(--spectre-text-primary)'
    }}>Font Families</h3>\r
      \r
      <div style={{
      marginBottom: '32px'
    }}>\r
        <p style={{
        fontFamily: 'var(--spectre-font-body)',
        marginBottom: '8px'
      }}>\r
          <strong>Body:</strong> Inter, -apple-system, sans-serif\r
        </p>\r
        <p style={{
        fontFamily: 'var(--spectre-font-display)',
        marginBottom: '8px'
      }}>\r
          <strong>Display:</strong> Space Grotesk, Inter, sans-serif\r
        </p>\r
        <p style={{
        fontFamily: 'var(--spectre-font-mono)'
      }}>\r
          <strong>Mono:</strong> JetBrains Mono, Fira Code, monospace\r
        </p>\r
      </div>\r
      \r
      <h3 style={{
      marginBottom: '24px',
      color: 'var(--spectre-text-primary)'
    }}>Type Scale</h3>\r
      \r
      <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '16px'
    }}>\r
        <div>\r
          <code style={{
          color: 'var(--spectre-accent)'
        }}>--spectre-text-4xl</code>\r
          <p style={{
          fontSize: '2.5rem',
          fontFamily: 'var(--spectre-font-display)'
        }}>Display XL (40px)</p>\r
        </div>\r
        <div>\r
          <code style={{
          color: 'var(--spectre-accent)'
        }}>--spectre-text-3xl</code>\r
          <p style={{
          fontSize: '2rem',
          fontFamily: 'var(--spectre-font-display)'
        }}>Display LG (32px)</p>\r
        </div>\r
        <div>\r
          <code style={{
          color: 'var(--spectre-accent)'
        }}>--spectre-text-2xl</code>\r
          <p style={{
          fontSize: '1.5rem'
        }}>Display MD (24px)</p>\r
        </div>\r
        <div>\r
          <code style={{
          color: 'var(--spectre-accent)'
        }}>--spectre-text-xl</code>\r
          <p style={{
          fontSize: '1.125rem'
        }}>Heading (18px)</p>\r
        </div>\r
        <div>\r
          <code style={{
          color: 'var(--spectre-accent)'
        }}>--spectre-text-lg</code>\r
          <p style={{
          fontSize: '1rem'
        }}>Large (16px)</p>\r
        </div>\r
        <div>\r
          <code style={{
          color: 'var(--spectre-accent)'
        }}>--spectre-text-md</code>\r
          <p style={{
          fontSize: '0.875rem'
        }}>Medium (14px)</p>\r
        </div>\r
        <div>\r
          <code style={{
          color: 'var(--spectre-accent)'
        }}>--spectre-text-base</code>\r
          <p style={{
          fontSize: '0.8125rem'
        }}>Base (13px)</p>\r
        </div>\r
        <div>\r
          <code style={{
          color: 'var(--spectre-accent)'
        }}>--spectre-text-sm</code>\r
          <p style={{
          fontSize: '0.75rem'
        }}>Small (12px)</p>\r
        </div>\r
        <div>\r
          <code style={{
          color: 'var(--spectre-accent)'
        }}>--spectre-text-xs</code>\r
          <p style={{
          fontSize: '0.6875rem'
        }}>Extra Small (11px)</p>\r
        </div>\r
      </div>\r
    </div>
}`,...(y=(u=c.parameters)==null?void 0:u.docs)==null?void 0:y.source}}};var g,h,f;o.parameters={...o.parameters,docs:{...(g=o.parameters)==null?void 0:g.docs,source:{originalSource:`{
  render: () => {
    const spaces = [{
      name: '--spectre-space-1',
      value: '4px'
    }, {
      name: '--spectre-space-2',
      value: '8px'
    }, {
      name: '--spectre-space-3',
      value: '12px'
    }, {
      name: '--spectre-space-4',
      value: '16px'
    }, {
      name: '--spectre-space-5',
      value: '20px'
    }, {
      name: '--spectre-space-6',
      value: '24px'
    }, {
      name: '--spectre-space-8',
      value: '32px'
    }, {
      name: '--spectre-space-10',
      value: '40px'
    }, {
      name: '--spectre-space-12',
      value: '48px'
    }, {
      name: '--spectre-space-16',
      value: '64px'
    }];
    return <div>\r
        <h3 style={{
        marginBottom: '24px',
        color: 'var(--spectre-text-primary)'
      }}>Spacing Scale (4px grid)</h3>\r
        {spaces.map(s => <div key={s.name} style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        marginBottom: '8px'
      }}>\r
            <div style={{
          width: s.value,
          height: '24px',
          background: 'var(--spectre-accent)',
          borderRadius: '4px'
        }} />\r
            <code style={{
          color: 'var(--spectre-accent)',
          width: '180px'
        }}>{s.name}</code>\r
            <span style={{
          color: 'var(--spectre-text-tertiary)'
        }}>{s.value}</span>\r
          </div>)}\r
      </div>;
  }
}`,...(f=(h=o.parameters)==null?void 0:h.docs)==null?void 0:f.source}}};var j,b,S;p.parameters={...p.parameters,docs:{...(j=p.parameters)==null?void 0:j.docs,source:{originalSource:`{
  render: () => {
    const radii = [{
      name: '--spectre-radius-sm',
      value: '4px'
    }, {
      name: '--spectre-radius-md',
      value: '8px'
    }, {
      name: '--spectre-radius-lg',
      value: '12px'
    }, {
      name: '--spectre-radius-xl',
      value: '16px'
    }, {
      name: '--spectre-radius-2xl',
      value: '24px'
    }, {
      name: '--spectre-radius-full',
      value: '9999px'
    }];
    return <div>\r
        <h3 style={{
        marginBottom: '24px',
        color: 'var(--spectre-text-primary)'
      }}>Border Radius</h3>\r
        <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '24px'
      }}>\r
          {radii.map(r => <div key={r.name} style={{
          textAlign: 'center'
        }}>\r
              <div style={{
            width: '80px',
            height: '80px',
            background: 'var(--spectre-accent)',
            borderRadius: r.value,
            marginBottom: '8px'
          }} />\r
              <code style={{
            color: 'var(--spectre-accent)',
            fontSize: '0.75rem'
          }}>{r.name}</code>\r
              <div style={{
            color: 'var(--spectre-text-tertiary)',
            fontSize: '0.75rem'
          }}>{r.value}</div>\r
            </div>)}\r
        </div>\r
      </div>;
  }
}`,...(S=(b=p.parameters)==null?void 0:b.docs)==null?void 0:S.source}}};var B,w,z;l.parameters={...l.parameters,docs:{...(B=l.parameters)==null?void 0:B.docs,source:{originalSource:`{
  render: () => {
    const shadows = [{
      name: '--spectre-shadow-xs',
      value: '0 1px 2px rgba(0, 0, 0, 0.5)'
    }, {
      name: '--spectre-shadow-sm',
      value: '0 2px 8px rgba(0, 0, 0, 0.6)'
    }, {
      name: '--spectre-shadow-md',
      value: '0 4px 16px rgba(0, 0, 0, 0.5)'
    }, {
      name: '--spectre-shadow-lg',
      value: '0 8px 32px rgba(0, 0, 0, 0.6)'
    }, {
      name: '--spectre-shadow-xl',
      value: '0 16px 48px rgba(0, 0, 0, 0.7)'
    }, {
      name: '--spectre-shadow-glow',
      value: '0 0 40px rgba(139, 92, 246, 0.5)'
    }];
    return <div>\r
        <h3 style={{
        marginBottom: '24px',
        color: 'var(--spectre-text-primary)'
      }}>Shadows</h3>\r
        <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: '24px'
      }}>\r
          {shadows.map(s => <div key={s.name} style={{
          textAlign: 'center'
        }}>\r
              <div style={{
            width: '100%',
            height: '80px',
            background: 'var(--spectre-bg-elevated)',
            borderRadius: '8px',
            boxShadow: s.value,
            marginBottom: '12px'
          }} />\r
              <code style={{
            color: 'var(--spectre-accent)',
            fontSize: '0.75rem'
          }}>{s.name}</code>\r
            </div>)}\r
        </div>\r
      </div>;
  }
}`,...(z=(w=l.parameters)==null?void 0:w.docs)==null?void 0:z.source}}};var F,k,C;i.parameters={...i.parameters,docs:{...(F=i.parameters)==null?void 0:F.docs,source:{originalSource:`{
  render: () => <div>\r
      <h3 style={{
      marginBottom: '24px',
      color: 'var(--spectre-text-primary)'
    }}>Animation Tokens</h3>\r
      \r
      <h4 style={{
      marginBottom: '12px',
      color: 'var(--spectre-text-secondary)'
    }}>Durations</h4>\r
      <div style={{
      marginBottom: '24px'
    }}>\r
        <div><code style={{
          color: 'var(--spectre-accent)'
        }}>--spectre-duration-fast</code>: 150ms</div>\r
        <div><code style={{
          color: 'var(--spectre-accent)'
        }}>--spectre-duration-normal</code>: 250ms</div>\r
        <div><code style={{
          color: 'var(--spectre-accent)'
        }}>--spectre-duration-slow</code>: 400ms</div>\r
      </div>\r
      \r
      <h4 style={{
      marginBottom: '12px',
      color: 'var(--spectre-text-secondary)'
    }}>Easing Functions</h4>\r
      <div style={{
      marginBottom: '24px'
    }}>\r
        <div><code style={{
          color: 'var(--spectre-accent)'
        }}>--spectre-easing-default</code>: cubic-bezier(0.4, 0, 0.2, 1)</div>\r
        <div><code style={{
          color: 'var(--spectre-accent)'
        }}>--spectre-easing-in</code>: cubic-bezier(0.4, 0, 1, 1)</div>\r
        <div><code style={{
          color: 'var(--spectre-accent)'
        }}>--spectre-easing-out</code>: cubic-bezier(0, 0, 0.2, 1)</div>\r
        <div><code style={{
          color: 'var(--spectre-accent)'
        }}>--spectre-easing-spring</code>: cubic-bezier(0.34, 1.56, 0.64, 1)</div>\r
      </div>\r
      \r
      <h4 style={{
      marginBottom: '12px',
      color: 'var(--spectre-text-secondary)'
    }}>Example Usage</h4>\r
      <pre style={{
      background: 'var(--spectre-bg-elevated)',
      padding: '16px',
      borderRadius: '8px',
      fontSize: '0.875rem',
      overflow: 'auto'
    }}>\r
      {\`.button {
  transition: all var(--spectre-duration-fast) var(--spectre-easing-default);
}

.modal {
  animation: fadeIn var(--spectre-duration-normal) var(--spectre-easing-spring);
}\`}\r
      </pre>\r
    </div>
}`,...(C=(k=i.parameters)==null?void 0:k.docs)==null?void 0:C.source}}};const G=["Colors","Typography","Spacing","BorderRadius","Shadows","Animation"];export{i as Animation,p as BorderRadius,s as Colors,l as Shadows,o as Spacing,c as Typography,G as __namedExportsOrder,R as default};
