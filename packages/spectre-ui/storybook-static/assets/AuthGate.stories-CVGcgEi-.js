import{j as e}from"./jsx-runtime-DF2Pcvd1.js";import{r as t}from"./index-B2-qRKKC.js";import"./_commonjsHelpers-Cpj98o6Y.js";const G=t.createContext(void 0);function h({children:r,password:D,storageKey:s="spectre-auth",title:W="Access Required",subtitle:K="Enter your credentials to continue",logo:m,brandColor:g}){const[y,u]=t.useState(!1),[x,p]=t.useState(""),[a,b]=t.useState(""),[V,L]=t.useState(!0);t.useEffect(()=>{localStorage.getItem(s)==="true"&&u(!0),L(!1)},[s]);const M=o=>{o.preventDefault(),b(""),x===D?(localStorage.setItem(s,"true"),u(!0)):(b("Incorrect password"),p(""))},H=()=>{localStorage.removeItem(s),u(!1),p("")};return V?e.jsx("div",{className:"spectre-auth-loading",children:e.jsx("div",{className:"spectre-auth-spinner"})}):y?e.jsx(G.Provider,{value:{isAuthenticated:y,logout:H},children:r}):e.jsxs("div",{className:"spectre-auth-gate",style:g?{"--auth-brand-color":g}:void 0,children:[e.jsx("div",{className:"spectre-auth-background",children:e.jsx("div",{className:"spectre-auth-gradient"})}),e.jsxs("div",{className:"spectre-auth-card",children:[m&&e.jsx("div",{className:"spectre-auth-logo",children:m}),e.jsx("h1",{className:"spectre-auth-title",children:W}),e.jsx("p",{className:"spectre-auth-subtitle",children:K}),e.jsxs("form",{onSubmit:M,className:"spectre-auth-form",children:[e.jsxs("div",{className:"spectre-auth-input-wrapper",children:[e.jsx("input",{type:"password",value:x,onChange:o=>p(o.target.value),placeholder:"Enter password",className:`spectre-auth-input ${a?"spectre-auth-input--error":""}`,autoFocus:!0,"aria-label":"Password","aria-invalid":!!a}),a&&e.jsx("span",{className:"spectre-auth-error",role:"alert",children:a})]}),e.jsxs("button",{type:"submit",className:"spectre-auth-button",children:[e.jsx("span",{children:"Access"}),e.jsx("svg",{viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:e.jsx("path",{d:"M5 12h14M12 5l7 7-7 7"})})]})]}),e.jsx("p",{className:"spectre-auth-footer",children:"Contact your administrator for access"})]})]})}function f(){const r=t.useContext(G);if(!r)throw new Error("useAuth must be used within an AuthGate");return r}try{h.displayName="AuthGate",h.__docgenInfo={description:"AuthGate component provides password-based access control.",displayName:"AuthGate",props:{children:{defaultValue:null,description:"The content to show when authenticated",name:"children",required:!0,type:{name:"ReactNode"}},password:{defaultValue:null,description:"The password required to access",name:"password",required:!0,type:{name:"string"}},storageKey:{defaultValue:{value:"spectre-auth"},description:"Storage key for auth state persistence",name:"storageKey",required:!1,type:{name:"string"}},title:{defaultValue:{value:"Access Required"},description:"Custom title for the login screen",name:"title",required:!1,type:{name:"string"}},subtitle:{defaultValue:{value:"Enter your credentials to continue"},description:"Custom subtitle/description",name:"subtitle",required:!1,type:{name:"string"}},logo:{defaultValue:null,description:"Logo element to display",name:"logo",required:!1,type:{name:"ReactNode"}},brandColor:{defaultValue:null,description:"Custom branding color",name:"brandColor",required:!1,type:{name:"string"}}}}}catch{}try{f.displayName="useAuth",f.__docgenInfo={description:"Hook to access auth state and logout function.",displayName:"useAuth",props:{}}}catch{}const O={title:"Components/AuthGate",component:h,parameters:{layout:"fullscreen",docs:{description:{component:`
AuthGate provides a password-protected entry point for your application.

## Features

- **Session Persistence**: Auth state is saved to localStorage
- **Customizable Branding**: Custom title, subtitle, logo, and colors
- **Error Handling**: Visual feedback for incorrect passwords
- **Accessible**: Proper ARIA attributes and keyboard navigation

## Usage

Wrap your entire app or protected sections:

\`\`\`tsx
import { AuthGate } from '@spectre-ai/ui';

function App() {
  return (
    <AuthGate 
      password={process.env.APP_PASSWORD}
      title="My Trading App"
      subtitle="Team access only"
    >
      <Dashboard />
    </AuthGate>
  );
}
\`\`\`

## Security Note

This is designed for simple team access control, not production security.
For production apps, use proper authentication services.
        `}}},tags:["autodocs"],argTypes:{password:{control:"text",description:"The password required for access"},title:{control:"text"},subtitle:{control:"text"},storageKey:{control:"text",description:"localStorage key for persisting auth state"}}},n={args:{password:"demo123",title:"Access Required",subtitle:"Enter your credentials to continue",storageKey:"storybook-auth-default",children:e.jsxs("div",{style:{padding:"40px",textAlign:"center",background:"var(--spectre-bg-base)",minHeight:"100vh"},children:[e.jsx("h1",{children:"🎉 You're In!"}),e.jsx("p",{style:{color:"var(--spectre-text-secondary)"},children:"Authentication successful. This is the protected content."})]})},parameters:{docs:{description:{story:"Default auth gate. Password: `demo123`"}}},play:async()=>{localStorage.removeItem("storybook-auth-default")}},i={args:{password:"demo123",title:"Spectre AI",subtitle:"Trading Platform Access",storageKey:"storybook-auth-logo",logo:e.jsx("span",{style:{fontSize:"2rem"},children:"👻"}),children:e.jsx("div",{children:"Protected Content"})},play:async()=>{localStorage.removeItem("storybook-auth-logo")}},c={args:{password:"demo123",title:"Admin Portal",subtitle:"Restricted access area",storageKey:"storybook-auth-custom",children:e.jsx("div",{children:"Protected Content"})},play:async()=>{localStorage.removeItem("storybook-auth-custom")}},l={args:{password:"trade2024",title:"Spectre Trading",subtitle:"Enter your team password",storageKey:"storybook-auth-trading",logo:e.jsxs("svg",{viewBox:"0 0 24 24",fill:"none",stroke:"white",strokeWidth:"2",style:{width:"40px",height:"40px"},children:[e.jsx("path",{d:"M12 2L2 7l10 5 10-5-10-5z"}),e.jsx("path",{d:"M2 17l10 5 10-5"}),e.jsx("path",{d:"M2 12l10 5 10-5"})]}),children:e.jsxs("div",{style:{padding:"40px",textAlign:"center",background:"var(--spectre-bg-base)",minHeight:"100vh"},children:[e.jsx("h1",{children:"Trading Dashboard"}),e.jsx("p",{style:{color:"var(--spectre-text-secondary)"},children:"Welcome to the trading platform!"})]})},parameters:{docs:{description:{story:"Trading platform auth gate. Password: `trade2024`"}}},play:async()=>{localStorage.removeItem("storybook-auth-trading")}},d={args:{password:"demo123",title:"Auth Gate",subtitle:"This story shows authenticated state",storageKey:"storybook-auth-authenticated",children:e.jsxs("div",{style:{padding:"40px",textAlign:"center",background:"var(--spectre-bg-base)",minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"16px"},children:[e.jsx("h1",{style:{fontSize:"2rem"},children:"🔓 Authenticated!"}),e.jsx("p",{style:{color:"var(--spectre-text-secondary)",maxWidth:"400px"},children:"This is what users see after successfully authenticating. The auth state persists in localStorage."}),e.jsx("button",{onClick:()=>{localStorage.removeItem("storybook-auth-authenticated"),window.location.reload()},style:{padding:"8px 16px",background:"var(--spectre-accent)",border:"none",borderRadius:"8px",color:"white",cursor:"pointer"},children:"Logout (for demo)"})]})},play:async()=>{localStorage.setItem("storybook-auth-authenticated","true")}};var v,w,A;n.parameters={...n.parameters,docs:{...(v=n.parameters)==null?void 0:v.docs,source:{originalSource:`{
  args: {
    password: 'demo123',
    title: 'Access Required',
    subtitle: 'Enter your credentials to continue',
    storageKey: 'storybook-auth-default',
    children: <div style={{
      padding: '40px',
      textAlign: 'center',
      background: 'var(--spectre-bg-base)',
      minHeight: '100vh'
    }}>\r
        <h1>🎉 You're In!</h1>\r
        <p style={{
        color: 'var(--spectre-text-secondary)'
      }}>\r
          Authentication successful. This is the protected content.\r
        </p>\r
      </div>
  },
  parameters: {
    docs: {
      description: {
        story: 'Default auth gate. Password: \`demo123\`'
      }
    }
  },
  play: async () => {
    // Clear auth for demo
    localStorage.removeItem('storybook-auth-default');
  }
}`,...(A=(w=n.parameters)==null?void 0:w.docs)==null?void 0:A.source}}};var S,k,j;i.parameters={...i.parameters,docs:{...(S=i.parameters)==null?void 0:S.docs,source:{originalSource:`{
  args: {
    password: 'demo123',
    title: 'Spectre AI',
    subtitle: 'Trading Platform Access',
    storageKey: 'storybook-auth-logo',
    logo: <span style={{
      fontSize: '2rem'
    }}>👻</span>,
    children: <div>Protected Content</div>
  },
  play: async () => {
    localStorage.removeItem('storybook-auth-logo');
  }
}`,...(j=(k=i.parameters)==null?void 0:k.docs)==null?void 0:j.source}}};var I,T,C;c.parameters={...c.parameters,docs:{...(I=c.parameters)==null?void 0:I.docs,source:{originalSource:`{
  args: {
    password: 'demo123',
    title: 'Admin Portal',
    subtitle: 'Restricted access area',
    storageKey: 'storybook-auth-custom',
    children: <div>Protected Content</div>
  },
  play: async () => {
    localStorage.removeItem('storybook-auth-custom');
  }
}`,...(C=(T=c.parameters)==null?void 0:T.docs)==null?void 0:C.source}}};var N,P,_;l.parameters={...l.parameters,docs:{...(N=l.parameters)==null?void 0:N.docs,source:{originalSource:`{
  args: {
    password: 'trade2024',
    title: 'Spectre Trading',
    subtitle: 'Enter your team password',
    storageKey: 'storybook-auth-trading',
    logo: <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" style={{
      width: '40px',
      height: '40px'
    }}>\r
        <path d="M12 2L2 7l10 5 10-5-10-5z" />\r
        <path d="M2 17l10 5 10-5" />\r
        <path d="M2 12l10 5 10-5" />\r
      </svg>,
    children: <div style={{
      padding: '40px',
      textAlign: 'center',
      background: 'var(--spectre-bg-base)',
      minHeight: '100vh'
    }}>\r
        <h1>Trading Dashboard</h1>\r
        <p style={{
        color: 'var(--spectre-text-secondary)'
      }}>\r
          Welcome to the trading platform!\r
        </p>\r
      </div>
  },
  parameters: {
    docs: {
      description: {
        story: 'Trading platform auth gate. Password: \`trade2024\`'
      }
    }
  },
  play: async () => {
    localStorage.removeItem('storybook-auth-trading');
  }
}`,...(_=(P=l.parameters)==null?void 0:P.docs)==null?void 0:_.source}}};var E,q,R;d.parameters={...d.parameters,docs:{...(E=d.parameters)==null?void 0:E.docs,source:{originalSource:`{
  args: {
    password: 'demo123',
    title: 'Auth Gate',
    subtitle: 'This story shows authenticated state',
    storageKey: 'storybook-auth-authenticated',
    children: <div style={{
      padding: '40px',
      textAlign: 'center',
      background: 'var(--spectre-bg-base)',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '16px'
    }}>\r
        <h1 style={{
        fontSize: '2rem'
      }}>🔓 Authenticated!</h1>\r
        <p style={{
        color: 'var(--spectre-text-secondary)',
        maxWidth: '400px'
      }}>\r
          This is what users see after successfully authenticating. \r
          The auth state persists in localStorage.\r
        </p>\r
        <button onClick={() => {
        localStorage.removeItem('storybook-auth-authenticated');
        window.location.reload();
      }} style={{
        padding: '8px 16px',
        background: 'var(--spectre-accent)',
        border: 'none',
        borderRadius: '8px',
        color: 'white',
        cursor: 'pointer'
      }}>\r
          Logout (for demo)\r
        </button>\r
      </div>
  },
  play: async () => {
    // Pre-authenticate for this story
    localStorage.setItem('storybook-auth-authenticated', 'true');
  }
}`,...(R=(q=d.parameters)==null?void 0:q.docs)==null?void 0:R.source}}};const Y=["Default","WithLogo","CustomBranding","TradingPlatform","Authenticated"];export{d as Authenticated,c as CustomBranding,n as Default,l as TradingPlatform,i as WithLogo,Y as __namedExportsOrder,O as default};
