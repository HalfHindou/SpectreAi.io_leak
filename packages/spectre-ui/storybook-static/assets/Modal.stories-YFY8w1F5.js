import{j as e}from"./jsx-runtime-DF2Pcvd1.js";import{r as a}from"./index-B2-qRKKC.js";import{fn as ie}from"./index-CLEdRh-S.js";import{r as ce}from"./index-kS-9iBlu.js";import{B as o}from"./Button-CYFESGiu.js";import{I}from"./Input-BO4WT-n1.js";import"./_commonjsHelpers-Cpj98o6Y.js";function l({isOpen:t,onClose:r,title:s,children:c,footer:k,size:se="md",closeOnOverlayClick:oe=!0,closeOnEscape:w=!0,showCloseButton:B=!0,className:ne=""}){const b=a.useRef(null),M=a.useRef(null);a.useEffect(()=>{if(!t||!w)return;const n=i=>{i.key==="Escape"&&r()};return document.addEventListener("keydown",n),()=>document.removeEventListener("keydown",n)},[t,w,r]),a.useEffect(()=>{var n,i;return t?(M.current=document.activeElement,document.body.style.overflow="hidden",(n=b.current)==null||n.focus()):(document.body.style.overflow="",(i=M.current)==null||i.focus()),()=>{document.body.style.overflow=""}},[t]),a.useEffect(()=>{if(!t)return;const n=b.current;if(!n)return;const i=n.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),d=i[0],p=i[i.length-1],S=u=>{u.key==="Tab"&&(u.shiftKey?document.activeElement===d&&(u.preventDefault(),p==null||p.focus()):document.activeElement===p&&(u.preventDefault(),d==null||d.focus()))};return n.addEventListener("keydown",S),()=>n.removeEventListener("keydown",S)},[t]);const ae=n=>{oe&&n.target===n.currentTarget&&r()};if(!t)return null;const le=e.jsx("div",{className:"spectre-modal-overlay",onClick:ae,"aria-modal":"true",role:"dialog","aria-labelledby":s?"spectre-modal-title":void 0,children:e.jsxs("div",{ref:b,className:`spectre-modal spectre-modal--${se} ${ne}`,tabIndex:-1,children:[(s||B)&&e.jsxs("div",{className:"spectre-modal-header",children:[s&&e.jsx("h2",{id:"spectre-modal-title",className:"spectre-modal-title",children:s}),B&&e.jsx("button",{type:"button",className:"spectre-modal-close",onClick:r,"aria-label":"Close modal",children:e.jsx("svg",{viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:e.jsx("path",{d:"M18 6L6 18M6 6l12 12"})})})]}),e.jsx("div",{className:"spectre-modal-content",children:c}),k&&e.jsx("div",{className:"spectre-modal-footer",children:k})]})});return ce.createPortal(le,document.body)}try{l.displayName="Modal",l.__docgenInfo={description:"Modal component for dialogs, confirmations, and forms.",displayName:"Modal",props:{isOpen:{defaultValue:null,description:"Whether the modal is open",name:"isOpen",required:!0,type:{name:"boolean"}},onClose:{defaultValue:null,description:"Callback when the modal should close",name:"onClose",required:!0,type:{name:"() => void"}},title:{defaultValue:null,description:"The title of the modal",name:"title",required:!1,type:{name:"string"}},children:{defaultValue:null,description:"The modal content",name:"children",required:!0,type:{name:"ReactNode"}},footer:{defaultValue:null,description:"Footer content (typically action buttons)",name:"footer",required:!1,type:{name:"ReactNode"}},size:{defaultValue:{value:"md"},description:"The size of the modal",name:"size",required:!1,type:{name:"enum",value:[{value:'"sm"'},{value:'"md"'},{value:'"lg"'},{value:'"xl"'},{value:'"full"'}]}},closeOnOverlayClick:{defaultValue:{value:"true"},description:"Whether clicking the overlay closes the modal",name:"closeOnOverlayClick",required:!1,type:{name:"boolean"}},closeOnEscape:{defaultValue:{value:"true"},description:"Whether pressing Escape closes the modal",name:"closeOnEscape",required:!1,type:{name:"boolean"}},showCloseButton:{defaultValue:{value:"true"},description:"Whether to show the close button",name:"showCloseButton",required:!1,type:{name:"boolean"}},className:{defaultValue:{value:""},description:"Custom class for the modal content",name:"className",required:!1,type:{name:"string"}}}}}catch{}const xe={title:"Components/Modal",component:l,parameters:{layout:"centered",docs:{description:{component:`
The Modal component provides a dialog overlay for confirmations, forms, and detailed content.

## Features

- **Focus Trap**: Keyboard focus is contained within the modal
- **Escape to Close**: Press Escape to close (configurable)
- **Click Outside**: Click overlay to close (configurable)
- **Body Scroll Lock**: Prevents background scrolling
- **Accessibility**: Proper ARIA attributes and focus management

## Sizes

- \`sm\`: 400px max - Simple confirmations
- \`md\`: 500px max - Forms and dialogs (default)
- \`lg\`: 640px max - Detailed content
- \`xl\`: 800px max - Large forms or content
- \`full\`: Full screen - Complex workflows
        `}}},tags:["autodocs"],argTypes:{size:{control:"select",options:["sm","md","lg","xl","full"]},closeOnOverlayClick:{control:"boolean"},closeOnEscape:{control:"boolean"},showCloseButton:{control:"boolean"}},args:{onClose:ie()}},O=({children:t,...r})=>{const[s,c]=a.useState(!1);return e.jsxs(e.Fragment,{children:[e.jsx(o,{onClick:()=>c(!0),children:"Open Modal"}),e.jsx(l,{...r,isOpen:s,onClose:()=>c(!1),children:t})]})},m={render:t=>e.jsx(O,{...t,children:e.jsx("p",{children:"This is a basic modal with some content. You can add any React content here."})}),args:{title:"Modal Title"}},f={render:t=>{const[r,s]=a.useState(!1);return e.jsxs(e.Fragment,{children:[e.jsx(o,{onClick:()=>s(!0),children:"Open Modal"}),e.jsx(l,{...t,isOpen:r,onClose:()=>s(!1),footer:e.jsxs(e.Fragment,{children:[e.jsx(o,{variant:"ghost",onClick:()=>s(!1),children:"Cancel"}),e.jsx(o,{onClick:()=>s(!1),children:"Confirm"})]}),children:e.jsx("p",{children:"Are you sure you want to proceed with this action?"})})]})},args:{title:"Confirm Action"}},h={render:t=>e.jsx(O,{...t,children:e.jsx("p",{children:"A small modal for simple confirmations."})}),args:{title:"Small Modal",size:"sm"}},g={render:t=>e.jsxs(O,{...t,children:[e.jsx("p",{children:"A large modal with more space for content. This is useful for displaying detailed information or forms with multiple fields."}),e.jsx("p",{style:{marginTop:"16px"},children:"You can include any content here including images, forms, or complex layouts."})]}),args:{title:"Large Modal",size:"lg"}},x={render:t=>e.jsx(O,{...t,children:e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"24px"},children:[e.jsxs("div",{children:[e.jsx("h3",{style:{marginBottom:"12px"},children:"Section 1"}),e.jsx("p",{children:"Content for the first section with detailed information."})]}),e.jsxs("div",{children:[e.jsx("h3",{style:{marginBottom:"12px"},children:"Section 2"}),e.jsx("p",{children:"Content for the second section with additional details."})]})]})}),args:{title:"Extra Large Modal",size:"xl"}},y={render:()=>{const[t,r]=a.useState(!1);return e.jsxs(e.Fragment,{children:[e.jsx(o,{variant:"danger",onClick:()=>r(!0),children:"Delete Token"}),e.jsx(l,{isOpen:t,onClose:()=>r(!1),title:"Delete Token",size:"sm",footer:e.jsxs(e.Fragment,{children:[e.jsx(o,{variant:"ghost",onClick:()=>r(!1),children:"Cancel"}),e.jsx(o,{variant:"danger",onClick:()=>r(!1),children:"Delete"})]}),children:e.jsx("p",{children:"Are you sure you want to remove this token from your watchlist? This action cannot be undone."})})]})},parameters:{docs:{description:{story:"A confirmation dialog for destructive actions."}}}},v={render:()=>{const[t,r]=a.useState(!1);return e.jsxs(e.Fragment,{children:[e.jsx(o,{onClick:()=>r(!0),children:"Connect Wallet"}),e.jsx(l,{isOpen:t,onClose:()=>r(!1),title:"Connect Wallet",footer:e.jsxs(e.Fragment,{children:[e.jsx(o,{variant:"ghost",onClick:()=>r(!1),children:"Cancel"}),e.jsx(o,{onClick:()=>r(!1),children:"Connect"})]}),children:e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:"16px"},children:[e.jsx(I,{label:"Wallet Address",placeholder:"Enter your wallet address...",fullWidth:!0}),e.jsx(I,{label:"Network",placeholder:"Select network...",fullWidth:!0})]})})]})},parameters:{docs:{description:{story:"A modal containing a form for user input."}}}},C={render:()=>{const[t,r]=a.useState(!1);return e.jsxs(e.Fragment,{children:[e.jsx(o,{variant:"success",onClick:()=>r(!0),children:"Execute Trade"}),e.jsx(l,{isOpen:t,onClose:()=>r(!1),title:"Confirm Trade",footer:e.jsxs(e.Fragment,{children:[e.jsx(o,{variant:"ghost",onClick:()=>r(!1),children:"Cancel"}),e.jsx(o,{variant:"success",onClick:()=>r(!1),children:"Confirm Trade"})]}),children:e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:"16px"},children:[e.jsxs("div",{style:{display:"flex",justifyContent:"space-between",padding:"12px",background:"var(--spectre-bg-elevated)",borderRadius:"var(--spectre-radius-md)"},children:[e.jsx("span",{style:{color:"var(--spectre-text-tertiary)"},children:"You Pay"}),e.jsx("span",{style:{fontFamily:"var(--spectre-font-mono)",fontWeight:600},children:"1.5 SOL"})]}),e.jsxs("div",{style:{display:"flex",justifyContent:"space-between",padding:"12px",background:"var(--spectre-bg-elevated)",borderRadius:"var(--spectre-radius-md)"},children:[e.jsx("span",{style:{color:"var(--spectre-text-tertiary)"},children:"You Receive"}),e.jsx("span",{style:{fontFamily:"var(--spectre-font-mono)",fontWeight:600,color:"var(--spectre-bull)"},children:"~2,450 SPECTRE"})]}),e.jsxs("div",{style:{display:"flex",justifyContent:"space-between",padding:"12px",background:"var(--spectre-bg-elevated)",borderRadius:"var(--spectre-radius-md)"},children:[e.jsx("span",{style:{color:"var(--spectre-text-tertiary)"},children:"Slippage"}),e.jsx("span",{children:"0.5%"})]})]})})]})},parameters:{docs:{description:{story:"Trade confirmation modal showing transaction details."}}}},j={render:t=>{const[r,s]=a.useState(!1);return e.jsxs(e.Fragment,{children:[e.jsx(o,{onClick:()=>s(!0),children:"Open Modal"}),e.jsx(l,{...t,isOpen:r,onClose:()=>s(!1),showCloseButton:!1,footer:e.jsx(o,{onClick:()=>s(!1),children:"Got it"}),children:e.jsx("p",{children:"This modal has no close button. Use the footer button to dismiss."})})]})},args:{title:"Important Notice",closeOnOverlayClick:!1,closeOnEscape:!1}};var T,E,D;m.parameters={...m.parameters,docs:{...(T=m.parameters)==null?void 0:T.docs,source:{originalSource:`{
  render: args => <ModalDemo {...args}>\r
      <p>This is a basic modal with some content. You can add any React content here.</p>\r
    </ModalDemo>,
  args: {
    title: 'Modal Title'
  }
}`,...(D=(E=m.parameters)==null?void 0:E.docs)==null?void 0:D.source}}};var F,A,W;f.parameters={...f.parameters,docs:{...(F=f.parameters)==null?void 0:F.docs,source:{originalSource:`{
  render: args => {
    const [isOpen, setIsOpen] = useState(false);
    return <>\r
        <Button onClick={() => setIsOpen(true)}>Open Modal</Button>\r
        <Modal {...args} isOpen={isOpen} onClose={() => setIsOpen(false)} footer={<>\r
              <Button variant="ghost" onClick={() => setIsOpen(false)}>\r
                Cancel\r
              </Button>\r
              <Button onClick={() => setIsOpen(false)}>\r
                Confirm\r
              </Button>\r
            </>}>\r
          <p>Are you sure you want to proceed with this action?</p>\r
        </Modal>\r
      </>;
  },
  args: {
    title: 'Confirm Action'
  }
}`,...(W=(A=f.parameters)==null?void 0:A.docs)==null?void 0:W.source}}};var N,R,L;h.parameters={...h.parameters,docs:{...(N=h.parameters)==null?void 0:N.docs,source:{originalSource:`{
  render: args => <ModalDemo {...args}>\r
      <p>A small modal for simple confirmations.</p>\r
    </ModalDemo>,
  args: {
    title: 'Small Modal',
    size: 'sm'
  }
}`,...(L=(R=h.parameters)==null?void 0:R.docs)==null?void 0:L.source}}};var z,q,V;g.parameters={...g.parameters,docs:{...(z=g.parameters)==null?void 0:z.docs,source:{originalSource:`{
  render: args => <ModalDemo {...args}>\r
      <p>A large modal with more space for content. This is useful for displaying detailed information or forms with multiple fields.</p>\r
      <p style={{
      marginTop: '16px'
    }}>You can include any content here including images, forms, or complex layouts.</p>\r
    </ModalDemo>,
  args: {
    title: 'Large Modal',
    size: 'lg'
  }
}`,...(V=(q=g.parameters)==null?void 0:q.docs)==null?void 0:V.source}}};var _,P,Y;x.parameters={...x.parameters,docs:{...(_=x.parameters)==null?void 0:_.docs,source:{originalSource:`{
  render: args => <ModalDemo {...args}>\r
      <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '24px'
    }}>\r
        <div>\r
          <h3 style={{
          marginBottom: '12px'
        }}>Section 1</h3>\r
          <p>Content for the first section with detailed information.</p>\r
        </div>\r
        <div>\r
          <h3 style={{
          marginBottom: '12px'
        }}>Section 2</h3>\r
          <p>Content for the second section with additional details.</p>\r
        </div>\r
      </div>\r
    </ModalDemo>,
  args: {
    title: 'Extra Large Modal',
    size: 'xl'
  }
}`,...(Y=(P=x.parameters)==null?void 0:P.docs)==null?void 0:Y.source}}};var G,K,U;y.parameters={...y.parameters,docs:{...(G=y.parameters)==null?void 0:G.docs,source:{originalSource:`{
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    return <>\r
        <Button variant="danger" onClick={() => setIsOpen(true)}>\r
          Delete Token\r
        </Button>\r
        <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Delete Token" size="sm" footer={<>\r
              <Button variant="ghost" onClick={() => setIsOpen(false)}>\r
                Cancel\r
              </Button>\r
              <Button variant="danger" onClick={() => setIsOpen(false)}>\r
                Delete\r
              </Button>\r
            </>}>\r
          <p>Are you sure you want to remove this token from your watchlist? This action cannot be undone.</p>\r
        </Modal>\r
      </>;
  },
  parameters: {
    docs: {
      description: {
        story: 'A confirmation dialog for destructive actions.'
      }
    }
  }
}`,...(U=(K=y.parameters)==null?void 0:K.docs)==null?void 0:U.source}}};var $,H,J;v.parameters={...v.parameters,docs:{...($=v.parameters)==null?void 0:$.docs,source:{originalSource:`{
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    return <>\r
        <Button onClick={() => setIsOpen(true)}>\r
          Connect Wallet\r
        </Button>\r
        <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Connect Wallet" footer={<>\r
              <Button variant="ghost" onClick={() => setIsOpen(false)}>\r
                Cancel\r
              </Button>\r
              <Button onClick={() => setIsOpen(false)}>\r
                Connect\r
              </Button>\r
            </>}>\r
          <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}>\r
            <Input label="Wallet Address" placeholder="Enter your wallet address..." fullWidth />\r
            <Input label="Network" placeholder="Select network..." fullWidth />\r
          </div>\r
        </Modal>\r
      </>;
  },
  parameters: {
    docs: {
      description: {
        story: 'A modal containing a form for user input.'
      }
    }
  }
}`,...(J=(H=v.parameters)==null?void 0:H.docs)==null?void 0:J.source}}};var Q,X,Z;C.parameters={...C.parameters,docs:{...(Q=C.parameters)==null?void 0:Q.docs,source:{originalSource:`{
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    return <>\r
        <Button variant="success" onClick={() => setIsOpen(true)}>\r
          Execute Trade\r
        </Button>\r
        <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Confirm Trade" footer={<>\r
              <Button variant="ghost" onClick={() => setIsOpen(false)}>\r
                Cancel\r
              </Button>\r
              <Button variant="success" onClick={() => setIsOpen(false)}>\r
                Confirm Trade\r
              </Button>\r
            </>}>\r
          <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}>\r
            <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '12px',
            background: 'var(--spectre-bg-elevated)',
            borderRadius: 'var(--spectre-radius-md)'
          }}>\r
              <span style={{
              color: 'var(--spectre-text-tertiary)'
            }}>You Pay</span>\r
              <span style={{
              fontFamily: 'var(--spectre-font-mono)',
              fontWeight: 600
            }}>1.5 SOL</span>\r
            </div>\r
            <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '12px',
            background: 'var(--spectre-bg-elevated)',
            borderRadius: 'var(--spectre-radius-md)'
          }}>\r
              <span style={{
              color: 'var(--spectre-text-tertiary)'
            }}>You Receive</span>\r
              <span style={{
              fontFamily: 'var(--spectre-font-mono)',
              fontWeight: 600,
              color: 'var(--spectre-bull)'
            }}>~2,450 SPECTRE</span>\r
            </div>\r
            <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '12px',
            background: 'var(--spectre-bg-elevated)',
            borderRadius: 'var(--spectre-radius-md)'
          }}>\r
              <span style={{
              color: 'var(--spectre-text-tertiary)'
            }}>Slippage</span>\r
              <span>0.5%</span>\r
            </div>\r
          </div>\r
        </Modal>\r
      </>;
  },
  parameters: {
    docs: {
      description: {
        story: 'Trade confirmation modal showing transaction details.'
      }
    }
  }
}`,...(Z=(X=C.parameters)==null?void 0:X.docs)==null?void 0:Z.source}}};var ee,te,re;j.parameters={...j.parameters,docs:{...(ee=j.parameters)==null?void 0:ee.docs,source:{originalSource:`{
  render: args => {
    const [isOpen, setIsOpen] = useState(false);
    return <>\r
        <Button onClick={() => setIsOpen(true)}>Open Modal</Button>\r
        <Modal {...args} isOpen={isOpen} onClose={() => setIsOpen(false)} showCloseButton={false} footer={<Button onClick={() => setIsOpen(false)}>\r
              Got it\r
            </Button>}>\r
          <p>This modal has no close button. Use the footer button to dismiss.</p>\r
        </Modal>\r
      </>;
  },
  args: {
    title: 'Important Notice',
    closeOnOverlayClick: false,
    closeOnEscape: false
  }
}`,...(re=(te=j.parameters)==null?void 0:te.docs)==null?void 0:re.source}}};const ye=["Default","WithFooter","Small","Large","ExtraLarge","ConfirmationDialog","FormModal","TradeConfirmation","NoCloseButton"];export{y as ConfirmationDialog,m as Default,x as ExtraLarge,v as FormModal,g as Large,j as NoCloseButton,h as Small,C as TradeConfirmation,f as WithFooter,ye as __namedExportsOrder,xe as default};
