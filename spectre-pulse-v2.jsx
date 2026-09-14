import { useState, useEffect, useRef, useCallback } from "react";

const S = {
  defi: { label: "DeFi", color: "#10B981" }, l1: { label: "Layer 1", color: "#8B5CF6" },
  l2: { label: "Layer 2", color: "#6366F1" }, ai: { label: "AI", color: "#F59E0B" },
  gaming: { label: "Gaming", color: "#EC4899" }, rwa: { label: "RWA", color: "#14B8A6" },
  meme: { label: "Meme", color: "#EF4444" }, infra: { label: "Infra", color: "#64748B" },
};

const NODES = [
  { id:"btc",x:.18,y:.12,r:40,label:"BTC",color:"#F7931A",sector:"l1",type:"project",tier:"S",tvl:"$1.2T",followers:"--" },
  { id:"eth",x:.42,y:.18,r:36,label:"ETH",color:"#627EEA",sector:"l1",type:"project",tier:"S",tvl:"$68B",followers:"--" },
  { id:"sol",x:.68,y:.14,r:30,label:"SOL",color:"#14F195",sector:"l1",type:"project",tier:"A",tvl:"$12B",followers:"--" },
  { id:"aave",x:.35,y:.38,r:22,label:"AAVE",color:"#B6509E",sector:"defi",type:"project",tier:"A",tvl:"$11.2B",followers:"--" },
  { id:"uni",x:.52,y:.42,r:20,label:"UNI",color:"#FF007A",sector:"defi",type:"project",tier:"A",tvl:"$5.4B",followers:"--" },
  { id:"arb",x:.62,y:.35,r:22,label:"ARB",color:"#28A0F0",sector:"l2",type:"project",tier:"B",tvl:"$3.2B",followers:"--" },
  { id:"op",x:.78,y:.28,r:18,label:"OP",color:"#FF0420",sector:"l2",type:"project",tier:"B",tvl:"$1.8B",followers:"--" },
  { id:"tao",x:.15,y:.42,r:18,label:"TAO",color:"#F59E0B",sector:"ai",type:"project",tier:"B",tvl:"$890M",followers:"--" },
  { id:"link",x:.55,y:.28,r:20,label:"LINK",color:"#2A5ADA",sector:"infra",type:"project",tier:"A",tvl:"$9.2B",followers:"--" },
  { id:"morpho",x:.28,y:.32,r:14,label:"MORPHO",color:"#2470FF",sector:"defi",type:"project",tier:"C",tvl:"$1.6B",followers:"--" },
  { id:"hyp",x:.88,y:.18,r:24,label:"HYP",color:"#FF4D6A",sector:"l1",type:"project",tier:"A",tvl:"$2.1B",followers:"--" },
  { id:"pendle",x:.48,y:.55,r:16,label:"PENDLE",color:"#12D8FA",sector:"defi",type:"project",tier:"B",tvl:"$2.1B",followers:"--" },
  { id:"ldo",x:.38,y:.52,r:14,label:"LDO",color:"#00A3FF",sector:"defi",type:"project",tier:"B",tvl:"$14.8B",followers:"--" },
  { id:"avax",x:.82,y:.38,r:20,label:"AVAX",color:"#E84142",sector:"l1",type:"project",tier:"A",tvl:"$1.4B",followers:"--" },
  { id:"sui",x:.9,y:.45,r:18,label:"SUI",color:"#6FBCF0",sector:"l1",type:"project",tier:"B",tvl:"$980M",followers:"--" },
  // KOLs
  { id:"cb",x:.72,y:.52,r:22,label:"CB",sub:"Coin Bureau",color:"#F7931A",sector:"l1",type:"kol",tier:"S",tvl:"--",followers:"2.4M" },
  { id:"ah",x:.58,y:.62,r:20,label:"AH",sub:"Arthur Hayes",color:"#8B5CF6",sector:"defi",type:"kol",tier:"S",tvl:"--",followers:"890K" },
  { id:"gcr",x:.32,y:.62,r:16,label:"GCR",sub:"GCR",color:"#10B981",sector:"defi",type:"kol",tier:"A",tvl:"--",followers:"340K" },
  { id:"zs",x:.45,y:.68,r:18,label:"ZS",sub:"Zhu Su",color:"#EF4444",sector:"l1",type:"kol",tier:"A",tvl:"--",followers:"620K" },
  { id:"pe",x:.78,y:.62,r:14,label:"PE",sub:"Pentoshi",color:"#14B8A6",sector:"defi",type:"kol",tier:"B",tvl:"--",followers:"410K" },
  { id:"jf",x:.88,y:.55,r:16,label:"JF",sub:"Jordan Fish",color:"#6366F1",sector:"l2",type:"kol",tier:"A",tvl:"--",followers:"520K" },
  { id:"dd",x:.22,y:.55,r:14,label:"DD",sub:"DataDash",color:"#EC4899",sector:"l1",type:"kol",tier:"B",tvl:"--",followers:"510K" },
];

const EDGES = [
  ["btc","eth"],["eth","aave"],["eth","uni"],["eth","arb"],["eth","link"],["eth","morpho"],["eth","ldo"],
  ["sol","hyp"],["sol","sui"],["arb","op"],["aave","morpho"],["aave","ldo"],["uni","pendle"],
  ["tao","eth"],["link","arb"],["avax","sui"],["cb","btc"],["cb","eth"],["ah","eth"],["ah","aave"],
  ["gcr","morpho"],["gcr","uni"],["zs","sol"],["zs","eth"],["pe","aave"],["pe","pendle"],
  ["jf","arb"],["jf","op"],["dd","btc"],["dd","sol"],
];

const genChart = (base, vol, n=24) => Array.from({length:n},(_,i)=> base + Math.sin(i*0.5)*vol + (Math.random()-0.4)*vol*0.6);
const genBar = (n=12) => Array.from({length:n},()=> 20+Math.random()*80);

const FEED = [
  { id:1,type:"signal",user:"Spectre Intelligence",verified:true,time:"4m",
    title:"$47M capital rotation into DeFi lending",
    body:"Unusual capital rotation detected. $47M moved from top-5 L1 tokens into DeFi lending protocols in 6 hours. This pattern preceded the last two DeFi rallies by 3-5 days.",
    chartType:"area",chart:genChart(20,15),chartColor:"#10B981",
    metric:{label:"Inflow",value:"+$47M",change:"+340%",positive:true},
    chips:[{l:"Aave",v:"+$18.2M"},{l:"Morpho",v:"+$12.7M"},{l:"Compound",v:"+$8.1M"}],
    confirms:142,challenges:38,saves:89 },
  { id:2,type:"post",user:"mkultra.eth",reputation:84,rank:"Top 2%",verified:true,time:"18m",sector:"DeFi",
    body:"Morpho Blue vault architecture is underappreciated. Their rate model creates a natural flywheel where supplier yields compress slower than borrow rates rise during demand spikes.",
    position:{token:"MORPHO",entry:"$1.42",pnl:"+34%",positive:true},
    chartType:"candle",chart:genChart(1.42,0.3),chartColor:"#10B981",
    confirms:89,challenges:12,saves:34 },
  { id:3,type:"build",user:"Aave",verified:true,time:"1h",sector:"DeFi",builderScore:94,
    title:"v3.2 deployed to mainnet",
    body:"14 commits this week, 3 contributors active. Umbrella safety module live with $240M coverage. Audit by Certora completed.",
    chartType:"bar",chart:genBar(),chartColor:"#F59E0B",
    metric:{label:"Builder Score",value:"94",change:"+3",positive:true},
    chips:[{l:"Commits",v:"14/wk"},{l:"TVL",v:"$11.2B"},{l:"Coverage",v:"$240M"}],
    confirms:214,challenges:3,saves:156 },
  { id:4,type:"signal",user:"Spectre Intelligence",verified:true,time:"2h",
    title:"Whale accumulation: 12,400 ETH in 72 hours",
    body:"3 wallets previously dormant for 8 months accumulated 12,400 ETH ($38.2M) across 47 transactions. Pattern consistent with institutional OTC accumulation before major catalysts.",
    chartType:"area",chart:genChart(2,12),chartColor:"#8B5CF6",
    metric:{label:"Accumulated",value:"$38.2M",change:"12,400 ETH",positive:true},
    confirms:267,challenges:41,saves:198 },
  { id:5,type:"post",user:"0xSisyphus.eth",reputation:91,rank:"Top 1%",verified:true,time:"2h",sector:"L2",
    body:"Arbitrum Stylus changes the game. Writing smart contracts in Rust with 10x gas efficiency isn't incremental. It's a platform shift. Every serious dev team I talk to is exploring it.",
    position:{token:"ARB",entry:"$0.82",pnl:"+67%",positive:true},
    chartType:"area",chart:genChart(0.82,0.35),chartColor:"#28A0F0",
    confirms:203,challenges:31,saves:87 },
  { id:6,type:"signal",user:"Spectre Intelligence",verified:true,time:"3h",
    title:"RWA narrative: attention +280% week-over-week",
    body:"RWA token attention grew 280% WoW across 34 monitored communities. BlackRock BUIDL fund crossed $500M. On-chain tokenized treasuries now exceed $2.1B.",
    chartType:"area",chart:genChart(10,25),chartColor:"#14B8A6",
    metric:{label:"Attention",value:"+280%",change:"34 communities",positive:true},
    chips:[{l:"ONDO",v:"+22%"},{l:"MPL",v:"+18%"},{l:"CFG",v:"+14%"}],
    confirms:312,challenges:47,saves:241 },
  { id:7,type:"build",user:"Lido",verified:true,time:"4h",sector:"DeFi",builderScore:88,
    title:"Community Staking Module v2",
    body:"Permissionless node operator onboarding now live. 12 new operators joined in 48 hours. DVT integration testing on Holesky complete.",
    chartType:"bar",chart:genBar(),chartColor:"#00A3FF",
    metric:{label:"Builder Score",value:"88",change:"+5",positive:true},
    chips:[{l:"Commits",v:"22/wk"},{l:"TVL",v:"$14.8B"},{l:"Operators",v:"+12"}],
    confirms:167,challenges:8,saves:94 },
  { id:8,type:"post",user:"degentrader.eth",reputation:76,rank:"Top 8%",verified:true,time:"5h",sector:"Meme",
    body:"Solana memecoin volume is 3.2x the 30-day average. Jupiter processing $2.8B daily. This is the distribution phase. Smart money is already rotating out. Volume without new buyers is the exit signal.",
    position:{token:"SOL",entry:"$124",pnl:"+12%",positive:true},
    chartType:"area",chart:genChart(124,20),chartColor:"#14F195",
    confirms:145,challenges:67,saves:52 },
];

const MATCH_QS = [
  { q: "What are you promoting?", opts: ["Token / Protocol", "NFT collection", "Web2 brand in Web3", "VC portfolio", "DAO / Community"] },
  { q: "Primary goal?", opts: ["New holders / users", "TVL growth", "Brand awareness", "Community growth", "Developer adoption"] },
  { q: "Target audience?", opts: ["DeFi degens", "Institutional / research", "Retail crypto", "Web2 consumers", "Developers"] },
  { q: "Budget range?", opts: ["Under $5K", "$5K - $25K", "$25K - $100K", "$100K - $500K", "$500K+"] },
];

function Spark({ data, color, w=200, h=48, type="area" }) {
  if (!data?.length) return null;
  const max = Math.max(...data), min = Math.min(...data), range = max-min||1;
  if (type === "bar") {
    const bw = w / data.length - 2;
    return (
      <svg width={w} height={h} style={{display:"block"}}>
        {data.map((v,i)=>{
          const bh = (v/100)*h*0.85;
          return <rect key={i} x={i*(bw+2)} y={h-bh} width={bw} height={bh} rx={2} fill={color} opacity={0.5+v/200} />;
        })}
      </svg>
    );
  }
  const pts = data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v-min)/range)*(h-6)-3}`).join(" ");
  const areaPts = pts + ` ${w},${h} 0,${h}`;
  return (
    <svg width={w} height={h} style={{display:"block"}}>
      <defs><linearGradient id={`sg${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.25"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
      <polygon points={areaPts} fill={`url(#sg${color.replace('#','')})`}/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function FeedItem({ item, idx }) {
  const [conf, setConf] = useState(false);
  const isSignal = item.type==="signal", isBuild = item.type==="build", isPost = item.type==="post";
  const accent = isSignal ? "#8B5CF6" : isBuild ? "#F59E0B" : "#818CF8";
  const badge = isSignal ? "Signal" : isBuild ? "Building" : null;
  const badgeCol = isSignal ? "#10B981" : "#F59E0B";

  return (
    <div style={{
      background:`linear-gradient(135deg, rgba(255,255,255,${isSignal?0.035:0.025}), rgba(255,255,255,0.008))`,
      border:`1px solid rgba(${isBuild?"245,158,11":"255,255,255"},${isBuild?0.08:0.05})`,
      borderRadius:16, marginBottom:10, overflow:"hidden",
      animation:`fsu 0.35s ease both`, animationDelay:`${idx*50}ms`,
    }}>
      <div style={{padding:"14px 16px 0"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
          <div style={{width:30,height:30,borderRadius:"50%",background:`${accent}18`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <span style={{fontSize:11,fontWeight:700,color:accent}}>{item.user[0]}</span>
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:12,fontWeight:500,color:"rgba(255,255,255,0.88)"}}>{item.user}</span>
              {item.verified && <span style={{width:5,height:5,borderRadius:"50%",background:"#10B981",display:"inline-block"}}/>}
              {item.reputation && <span style={{fontSize:10,color:"rgba(255,255,255,0.3)",marginLeft:4}}>{item.reputation}% accuracy</span>}
            </div>
            {item.rank && <div style={{fontSize:10,color:"rgba(255,255,255,0.25)"}}>{item.rank}</div>}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            {badge && <span style={{fontSize:8,padding:"2px 7px",borderRadius:5,background:badgeCol+"18",color:badgeCol,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>{badge}</span>}
            <span style={{fontSize:10,color:"rgba(255,255,255,0.25)"}}>{item.time}</span>
          </div>
        </div>
        {item.title && <div style={{fontSize:14,fontWeight:600,color:"#fff",marginBottom:6,fontFamily:"'Space Grotesk',sans-serif",letterSpacing:"-0.01em",lineHeight:1.3}}>{item.title}</div>}
        <div style={{fontSize:12,color:"rgba(255,255,255,0.5)",lineHeight:1.65,marginBottom:item.metric?8:12}}>{item.body}</div>
        {item.metric && (
          <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:8}}>
            <span style={{fontSize:9,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:"0.05em"}}>{item.metric.label}</span>
            <span style={{fontSize:22,fontWeight:700,color:item.metric.positive?"#10B981":"#EF4444",fontFamily:"'JetBrains Mono',monospace"}}>{item.metric.value}</span>
            <span style={{fontSize:11,color:"rgba(255,255,255,0.35)",fontFamily:"'JetBrains Mono',monospace"}}>{item.metric.change}</span>
          </div>
        )}
      </div>

      <div style={{padding:"0 16px",marginBottom:item.chips||item.position?8:0}}>
        <Spark data={item.chart} color={item.chartColor} w={400} h={item.metric?56:44} type={item.chartType}/>
      </div>

      <div style={{padding:"0 16px 12px"}}>
        {item.chips && (
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10,marginTop:8}}>
            {item.chips.map((c,i)=>(
              <span key={i} style={{fontSize:10,padding:"3px 9px",borderRadius:7,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.05)",fontFamily:"'JetBrains Mono',monospace"}}>
                <span style={{color:"rgba(255,255,255,0.4)"}}>{c.l} </span>
                <span style={{color:String(c.v).startsWith("+")?`${item.chartColor}`:"#fff",fontWeight:500}}>{c.v}</span>
              </span>
            ))}
          </div>
        )}
        {item.position && (
          <div style={{display:"flex",gap:6,marginBottom:10,marginTop:8}}>
            <span style={{fontSize:10,padding:"3px 9px",borderRadius:7,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.05)",fontFamily:"'JetBrains Mono',monospace"}}>
              <span style={{color:"rgba(255,255,255,0.4)"}}>Holding </span><span style={{color:"#fff",fontWeight:500}}>{item.position.token}</span>
            </span>
            <span style={{fontSize:10,padding:"3px 9px",borderRadius:7,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.05)",fontFamily:"'JetBrains Mono',monospace",color:"rgba(255,255,255,0.5)"}}>
              Entry {item.position.entry}
            </span>
            <span style={{fontSize:10,padding:"3px 9px",borderRadius:7,background:item.position.positive?"rgba(16,185,129,0.08)":"rgba(239,68,68,0.08)",border:`1px solid ${item.position.positive?"rgba(16,185,129,0.15)":"rgba(239,68,68,0.15)"}`,fontFamily:"'JetBrains Mono',monospace",color:item.position.positive?"#10B981":"#EF4444",fontWeight:600}}>
              {item.position.pnl}
            </span>
          </div>
        )}
        <div style={{display:"flex",gap:16,paddingTop:8,borderTop:"1px solid rgba(255,255,255,0.03)"}}>
          <span onClick={()=>setConf(!conf)} style={{fontSize:11,color:conf?"#10B981":"rgba(255,255,255,0.25)",cursor:"pointer",transition:"color 0.15s"}}>{conf?item.confirms+1:item.confirms} confirms</span>
          <span style={{fontSize:11,color:"rgba(255,255,255,0.25)",cursor:"pointer"}}>{item.challenges} challenges</span>
          <span style={{fontSize:11,color:"rgba(255,255,255,0.25)",cursor:"pointer",marginLeft:"auto"}}>{item.saves} saves</span>
        </div>
      </div>
    </div>
  );
}

function ConnectionProtocol({ activeSector, setActiveSector }) {
  const canvasRef = useRef(null);
  const hovRef = useRef(null);
  const [tip, setTip] = useState(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");

  const filtered = NODES.filter(n => {
    if (search && !n.label.toLowerCase().includes(search.toLowerCase()) && !(n.sub||"").toLowerCase().includes(search.toLowerCase())) return false;
    if (activeSector && n.sector !== activeSector) return false;
    if (typeFilter !== "all" && n.type !== typeFilter) return false;
    if (tierFilter !== "all" && n.tier !== tierFilter) return false;
    return true;
  });

  useEffect(() => {
    const c = canvasRef.current; if(!c) return;
    const ctx = c.getContext("2d");
    const dpr = window.devicePixelRatio||1;
    const W = c.clientWidth, H = c.clientHeight;
    c.width = W*dpr; c.height = H*dpr; ctx.scale(dpr,dpr);
    let frame, t=0;
    const hex2rgb = h => { const r=parseInt(h.slice(1,3),16),g=parseInt(h.slice(3,5),16),b=parseInt(h.slice(5,7),16); return `${r},${g},${b}`; };
    const fIds = new Set(filtered.map(n=>n.id));

    function draw(){
      t+=0.005; ctx.clearRect(0,0,W,H);
      EDGES.forEach(([a,b])=>{
        const na=NODES.find(n=>n.id===a), nb=NODES.find(n=>n.id===b);
        if(!na||!nb) return;
        const show = fIds.has(a) && fIds.has(b);
        const ax=na.x*W+Math.sin(t+na.x*12)*3, ay=na.y*H+Math.cos(t+na.y*9)*2;
        const bx=nb.x*W+Math.sin(t+nb.x*12)*3, by=nb.y*H+Math.cos(t+nb.y*9)*2;
        ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(bx,by);
        ctx.strokeStyle = show ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.01)";
        ctx.lineWidth = show ? 0.7 : 0.3; ctx.stroke();
      });
      NODES.forEach(node => {
        const x=node.x*W+Math.sin(t+node.x*12)*3, y=node.y*H+Math.cos(t+node.y*9)*2;
        const show = fIds.has(node.id);
        const hov = hovRef.current===node.id;
        const a = show ? 1 : 0.08;
        const r = hov ? node.r*1.2 : node.r;
        if(hov && show){ ctx.beginPath(); ctx.arc(x,y,r+10,0,Math.PI*2); ctx.fillStyle=`rgba(${hex2rgb(node.color)},0.05)`; ctx.fill(); }
        ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
        ctx.fillStyle = `rgba(${hex2rgb(node.color)},${0.12*a})`;
        ctx.fill();
        if(node.type==="kol"){ ctx.setLineDash([3,3]); } else { ctx.setLineDash([]); }
        ctx.strokeStyle = `rgba(${hex2rgb(node.color)},${(hov?0.8:0.4)*a})`;
        ctx.lineWidth = hov ? 1.5 : 0.8; ctx.stroke(); ctx.setLineDash([]);
        // Tier badge
        if(show && r > 12){
          const tc = node.tier==="S"?"#EF4444":node.tier==="A"?"#F59E0B":node.tier==="B"?"#3B82F6":"#6B7280";
          ctx.beginPath(); ctx.arc(x+r*0.7,y-r*0.7,6,0,Math.PI*2);
          ctx.fillStyle=tc; ctx.fill();
          ctx.fillStyle="#fff"; ctx.font="bold 7px 'Inter',sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
          ctx.fillText(node.tier,x+r*0.7,y-r*0.7);
        }
        ctx.fillStyle=`rgba(255,255,255,${0.9*a})`; ctx.font=`600 ${r>22?12:r>16?10:8}px 'Space Grotesk',sans-serif`;
        ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText(node.label,x,y);
        if(show && node.sub && r > 14){
          ctx.fillStyle=`rgba(255,255,255,${0.3*a})`; ctx.font=`400 8px 'Inter',sans-serif`;
          ctx.fillText(node.sub,x,y+r*0.65);
        }
      });
      frame = requestAnimationFrame(draw);
    }
    draw();
    const hm = e => {
      const rect=c.getBoundingClientRect(), mx=e.clientX-rect.left, my=e.clientY-rect.top;
      let found=null;
      NODES.forEach(n=>{
        const nx=n.x*W+Math.sin(t+n.x*12)*3, ny=n.y*H+Math.cos(t+n.y*9)*2;
        if(Math.sqrt((mx-nx)**2+(my-ny)**2)<n.r+5) found=n;
      });
      hovRef.current=found?.id||null;
      c.style.cursor=found?"pointer":"default";
      setTip(found?{...found,mx:e.clientX-rect.left,my:e.clientY-rect.top}:null);
    };
    c.addEventListener("mousemove",hm);
    return ()=>{cancelAnimationFrame(frame);c.removeEventListener("mousemove",hm);};
  }, [filtered.length, activeSector, typeFilter, tierFilter, search]);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"12px 16px",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
        <div style={{fontSize:14,fontWeight:600,color:"#fff",fontFamily:"'Space Grotesk',sans-serif",marginBottom:8}}>Connection Protocol</div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search projects, KOLs..." style={{
          width:"100%",height:32,borderRadius:8,border:"1px solid rgba(255,255,255,0.06)",
          background:"rgba(255,255,255,0.03)",padding:"0 10px",fontSize:11,color:"#fff",outline:"none",marginBottom:8}} />
        <div style={{display:"flex",gap:4,marginBottom:6,flexWrap:"wrap"}}>
          {["all","project","kol"].map(t=>(
            <span key={t} onClick={()=>setTypeFilter(t)} style={{fontSize:10,padding:"3px 10px",borderRadius:6,cursor:"pointer",
              background:typeFilter===t?"rgba(139,92,246,0.15)":"rgba(255,255,255,0.03)",
              border:`1px solid ${typeFilter===t?"rgba(139,92,246,0.25)":"rgba(255,255,255,0.04)"}`,
              color:typeFilter===t?"#8B5CF6":"rgba(255,255,255,0.35)",fontWeight:typeFilter===t?600:400,textTransform:"capitalize"}}>
              {t==="all"?"All":t==="kol"?"KOLs":"Projects"}
            </span>
          ))}
          <span style={{width:1,background:"rgba(255,255,255,0.06)",margin:"0 2px"}}/>
          {["all","S","A","B","C"].map(t=>(
            <span key={t} onClick={()=>setTierFilter(t)} style={{fontSize:10,padding:"3px 8px",borderRadius:6,cursor:"pointer",
              background:tierFilter===t?(t==="S"?"rgba(239,68,68,0.15)":t==="A"?"rgba(245,158,11,0.15)":t==="B"?"rgba(59,130,246,0.15)":t==="C"?"rgba(107,114,128,0.15)":"rgba(255,255,255,0.06)"):"rgba(255,255,255,0.02)",
              border:`1px solid ${tierFilter===t?"rgba(255,255,255,0.1)":"rgba(255,255,255,0.03)"}`,
              color:tierFilter===t?(t==="S"?"#EF4444":t==="A"?"#F59E0B":t==="B"?"#3B82F6":t==="C"?"#6B7280":"#fff"):"rgba(255,255,255,0.3)",fontWeight:tierFilter===t?600:400}}>
              {t==="all"?"All Tiers":t+"-Tier"}
            </span>
          ))}
        </div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {Object.entries(S).map(([id,s])=>(
            <span key={id} onClick={()=>setActiveSector(activeSector===id?null:id)} style={{fontSize:9,padding:"2px 7px",borderRadius:5,cursor:"pointer",
              background:activeSector===id?s.color+"20":"rgba(255,255,255,0.02)",
              border:`1px solid ${activeSector===id?s.color+"40":"rgba(255,255,255,0.04)"}`,
              color:activeSector===id?s.color:"rgba(255,255,255,0.3)",transition:"all 0.15s"}}>
              {s.label}
            </span>
          ))}
        </div>
        <div style={{display:"flex",gap:12,marginTop:8,fontSize:10,color:"rgba(255,255,255,0.3)"}}>
          <span><span style={{fontFamily:"'JetBrains Mono',monospace",color:"#8B5CF6"}}>{filtered.filter(n=>n.type==="project").length}</span> Projects</span>
          <span><span style={{fontFamily:"'JetBrains Mono',monospace",color:"#F59E0B"}}>{filtered.filter(n=>n.type==="kol").length}</span> KOLs</span>
          <span><span style={{fontFamily:"'JetBrains Mono',monospace",color:"#fff"}}>{filtered.length}</span> Total</span>
        </div>
      </div>
      <div style={{flex:1,position:"relative"}}>
        <canvas ref={canvasRef} style={{width:"100%",height:"100%",display:"block"}} />
        {tip && (
          <div style={{position:"absolute",left:Math.min(tip.mx+12,280),top:tip.my-50,background:"rgba(19,19,22,0.95)",border:"1px solid rgba(255,255,255,0.1)",
            borderRadius:10,padding:"10px 14px",pointerEvents:"none",backdropFilter:"blur(12px)",zIndex:10,minWidth:140}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
              <span style={{fontSize:13,fontWeight:600,color:tip.color}}>{tip.label}</span>
              <span style={{fontSize:8,padding:"1px 5px",borderRadius:4,background:tip.tier==="S"?"#EF4444":tip.tier==="A"?"#F59E0B":"#3B82F6",color:"#fff",fontWeight:700}}>{tip.tier}</span>
              <span style={{fontSize:9,padding:"1px 5px",borderRadius:4,background:"rgba(255,255,255,0.06)",color:"rgba(255,255,255,0.4)"}}>{tip.type}</span>
            </div>
            {tip.sub && <div style={{fontSize:10,color:"rgba(255,255,255,0.5)",marginBottom:2}}>{tip.sub}</div>}
            <div style={{fontSize:10,color:"rgba(255,255,255,0.35)"}}>
              {tip.type==="project"?`TVL: ${tip.tvl}`:`Followers: ${tip.followers}`}
            </div>
          </div>
        )}
      </div>
      <div style={{padding:"8px 16px 12px",borderTop:"1px solid rgba(255,255,255,0.04)",display:"flex",gap:8,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:4,fontSize:9,color:"rgba(255,255,255,0.3)"}}>
          <span style={{width:8,height:8,borderRadius:"50%",border:"1px solid rgba(255,255,255,0.2)"}}/>Project
        </div>
        <div style={{display:"flex",alignItems:"center",gap:4,fontSize:9,color:"rgba(255,255,255,0.3)"}}>
          <span style={{width:8,height:8,borderRadius:"50%",border:"1px dashed rgba(255,255,255,0.2)"}}/>KOL
        </div>
        {[["S","#EF4444"],["A","#F59E0B"],["B","#3B82F6"],["C","#6B7280"]].map(([t,c])=>(
          <div key={t} style={{display:"flex",alignItems:"center",gap:3,fontSize:9,color:"rgba(255,255,255,0.3)"}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:c,fontSize:6,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{t}</span>{t}-Tier
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchMaker() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [result, setResult] = useState(null);

  const select = (opt) => {
    const na = [...answers, opt];
    setAnswers(na);
    if (step < MATCH_QS.length - 1) { setStep(step + 1); }
    else {
      setResult({
        audience: "34,200 verified wallets",
        surfaces: 147,
        sectors: ["DeFi","L2"],
        estCPA: "$4.80",
        channels: [{name:"Intelligence feeds",pct:35},{name:"Verified community",pct:28},{name:"Builder surfaces",pct:22},{name:"Narrative placement",pct:15}],
        summary: `Based on your profile (${na[0]}, targeting ${na[2]}, budget ${na[3]}), the engine recommends distributing verified intelligence across 147 surfaces focused on ${na[2]} audiences. Proof-of-build cards will surface your development activity to sector-relevant feeds. Narrative timing engine will align your visibility with forming sector narratives.`
      });
    }
  };
  const reset = () => { setStep(0); setAnswers([]); setResult(null); };

  if (result) {
    return (
      <div style={{padding:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <span style={{fontSize:14,fontWeight:600,color:"#fff",fontFamily:"'Space Grotesk',sans-serif"}}>Your campaign plan</span>
          <span onClick={reset} style={{fontSize:11,color:"#8B5CF6",cursor:"pointer"}}>Start over</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
          {[{l:"Matched wallets",v:result.audience},{l:"Surfaces",v:result.surfaces},{l:"Est. CPA",v:result.estCPA}].map((m,i)=>(
            <div key={i} style={{background:"rgba(255,255,255,0.03)",borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:3}}>{m.l}</div>
              <div style={{fontSize:15,fontWeight:600,color:"#fff",fontFamily:"'JetBrains Mono',monospace"}}>{m.v}</div>
            </div>
          ))}
        </div>
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",marginBottom:8}}>Distribution mix</div>
          {result.channels.map((ch,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
              <span style={{fontSize:10,color:"rgba(255,255,255,0.4)",width:110}}>{ch.name}</span>
              <div style={{flex:1,height:4,borderRadius:2,background:"rgba(255,255,255,0.04)"}}>
                <div style={{height:"100%",borderRadius:2,background:"#8B5CF6",width:`${ch.pct}%`,opacity:0.4+ch.pct/100*0.6}}/>
              </div>
              <span style={{fontSize:10,color:"#8B5CF6",fontFamily:"'JetBrains Mono',monospace",width:28,textAlign:"right"}}>{ch.pct}%</span>
            </div>
          ))}
        </div>
        <div style={{padding:"12px 14px",borderRadius:12,background:"rgba(16,185,129,0.05)",border:"1px solid rgba(16,185,129,0.1)"}}>
          <div style={{fontSize:11,fontWeight:500,color:"#10B981",marginBottom:4}}>Engine recommendation</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",lineHeight:1.6}}>{result.summary}</div>
        </div>
      </div>
    );
  }

  const q = MATCH_QS[step];
  return (
    <div style={{padding:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <span style={{fontSize:14,fontWeight:600,color:"#fff",fontFamily:"'Space Grotesk',sans-serif"}}>Find your audience</span>
        <span style={{fontSize:10,color:"rgba(255,255,255,0.3)"}}>{step+1} / {MATCH_QS.length}</span>
      </div>
      <div style={{display:"flex",gap:3,marginBottom:16}}>
        {MATCH_QS.map((_,i)=>(
          <div key={i} style={{flex:1,height:2,borderRadius:1,background:i<=step?"#8B5CF6":"rgba(255,255,255,0.06)"}}/>
        ))}
      </div>
      <div style={{fontSize:15,fontWeight:500,color:"#fff",marginBottom:16}}>{q.q}</div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {q.opts.map((o,i)=>(
          <div key={i} onClick={()=>select(o)} style={{
            padding:"12px 14px",borderRadius:10,background:"rgba(255,255,255,0.03)",
            border:"1px solid rgba(255,255,255,0.06)",cursor:"pointer",fontSize:13,
            color:"rgba(255,255,255,0.65)",transition:"all 0.15s",
          }} onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(139,92,246,0.3)";e.currentTarget.style.color="#fff"}}
             onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(255,255,255,0.06)";e.currentTarget.style.color="rgba(255,255,255,0.65)"}}>
            {o}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SpectrePulse() {
  const [activeStory, setActiveStory] = useState(null);
  const [activeSector, setActiveSector] = useState(null);
  const [feedFilter, setFeedFilter] = useState("all");
  const [rightTab, setRightTab] = useState("protocol");
  const [storyMode, setStoryMode] = useState("cards");

  const filteredFeed = feedFilter==="all"?FEED: feedFilter==="signals"?FEED.filter(f=>f.type==="signal"):
    feedFilter==="community"?FEED.filter(f=>f.type==="post"): feedFilter==="building"?FEED.filter(f=>f.type==="build"):FEED;

  return (
    <div style={{width:"100%",minHeight:"100vh",background:"#0c0c0e",color:"#fff",fontFamily:"'Inter',-apple-system,sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,600;1,400&display=swap');
        @keyframes fsu{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        *{-webkit-tap-highlight-color:transparent;box-sizing:border-box;margin:0}
        ::-webkit-scrollbar{width:3px;height:3px}::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.06);border-radius:2px}
      `}</style>

      {activeStory && (
        <div style={{position:"fixed",inset:0,zIndex:200,background:"rgba(0,0,0,0.85)",backdropFilter:"blur(20px)",display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setActiveStory(null)}>
          <div onClick={e=>e.stopPropagation()} style={{width:420,background:"linear-gradient(135deg,#131316,#0c0c0e)",borderRadius:24,border:"1px solid rgba(255,255,255,0.08)",padding:28}}>
            <div style={{textAlign:"center",marginBottom:16}}>
              <div style={{fontSize:42,fontWeight:700,color:activeStory.chartColor||"#8B5CF6",fontFamily:"'JetBrains Mono',monospace"}}>{activeStory.metric?.value||activeStory.position?.pnl||""}</div>
              <div style={{fontSize:18,fontWeight:600,color:"#fff",marginTop:8,fontFamily:"'Space Grotesk',sans-serif"}}>{activeStory.title||activeStory.body?.slice(0,60)+"..."}</div>
            </div>
            <div style={{display:"flex",justifyContent:"center",marginBottom:16}}><Spark data={activeStory.chart} color={activeStory.chartColor} w={320} h={80} type={activeStory.chartType}/></div>
            <div style={{fontSize:12,color:"rgba(255,255,255,0.5)",lineHeight:1.7,textAlign:"center",marginBottom:20}}>{activeStory.body}</div>
            <div style={{display:"flex",justifyContent:"center",gap:10}}>
              {["Confirm","Challenge","Save"].map(a=>(<button key={a} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"8px 20px",color:a==="Confirm"?"#10B981":"rgba(255,255,255,0.4)",fontSize:12,cursor:"pointer"}}>{a}</button>))}
            </div>
          </div>
        </div>
      )}

      <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 24px",borderBottom:"1px solid rgba(255,255,255,0.04)",background:"rgba(12,12,14,0.98)",backdropFilter:"blur(12px)",position:"sticky",top:0,zIndex:50}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:26,height:26,borderRadius:7,background:"linear-gradient(135deg,#8B5CF6,#6366F1)",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <span style={{fontSize:12,fontWeight:700,color:"#fff"}}>S</span>
          </div>
          <span style={{fontSize:16,fontWeight:600,fontFamily:"'Space Grotesk',sans-serif",letterSpacing:"-0.03em"}}>Spectre Pulse</span>
          <div style={{display:"flex",alignItems:"center",gap:4,marginLeft:8}}>
            <span style={{width:5,height:5,borderRadius:"50%",background:"#10B981",animation:"pulse 2s ease-in-out infinite"}}/>
            <span style={{fontSize:10,color:"rgba(255,255,255,0.3)"}}>Live</span>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <input placeholder="Search..." style={{width:220,height:30,borderRadius:8,border:"1px solid rgba(255,255,255,0.06)",background:"rgba(255,255,255,0.03)",padding:"0 10px",fontSize:11,color:"#fff",outline:"none"}}/>
          <div style={{width:30,height:30,borderRadius:8,background:"rgba(139,92,246,0.12)",border:"1px solid rgba(139,92,246,0.2)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
            <span style={{fontSize:12,fontWeight:600,color:"#8B5CF6"}}>S</span>
          </div>
        </div>
      </header>

      <div style={{padding:"10px 24px",borderBottom:"1px solid rgba(255,255,255,0.04)",background:"rgba(255,255,255,0.008)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <div style={{display:"flex",gap:6}}>
            {["cards","circles"].map(m=>(
              <span key={m} onClick={()=>setStoryMode(m)} style={{fontSize:10,padding:"3px 10px",borderRadius:6,cursor:"pointer",background:storyMode===m?"rgba(255,255,255,0.06)":"transparent",color:storyMode===m?"#fff":"rgba(255,255,255,0.3)",border:`1px solid ${storyMode===m?"rgba(255,255,255,0.08)":"transparent"}`,textTransform:"capitalize"}}>{m==="cards"?"Cards":"Stories"}</span>
            ))}
          </div>
          <span style={{fontSize:10,color:"rgba(255,255,255,0.2)"}}>{FEED.length} signals live</span>
        </div>
        <div style={{display:"flex",gap:storyMode==="circles"?14:8,overflowX:"auto",paddingBottom:6}}>
          {FEED.map((s,i) => storyMode==="circles" ? (
            <div key={s.id} onClick={()=>setActiveStory(s)} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5,cursor:"pointer",minWidth:64}}>
              <div style={{width:54,height:54,borderRadius:"50%",padding:2,background:`linear-gradient(135deg,${s.chartColor},${s.chartColor}55)`}}>
                <div style={{width:"100%",height:"100%",borderRadius:"50%",background:"#131316",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <span style={{fontSize:9,fontWeight:700,color:s.chartColor,fontFamily:"'JetBrains Mono',monospace"}}>{s.metric?.value||s.position?.pnl||""}</span>
                </div>
              </div>
              <span style={{fontSize:8,color:"rgba(255,255,255,0.35)",maxWidth:64,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"center"}}>{s.title||s.user}</span>
            </div>
          ) : (
            <div key={s.id} onClick={()=>setActiveStory(s)} style={{minWidth:240,maxWidth:240,padding:"10px 12px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)",borderRadius:12,cursor:"pointer",flexShrink:0}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span style={{fontSize:8,padding:"2px 6px",borderRadius:4,background:s.chartColor+"18",color:s.chartColor,fontWeight:700,textTransform:"uppercase"}}>{s.type}</span>
                <span style={{fontSize:9,color:"rgba(255,255,255,0.25)"}}>{s.time}</span>
              </div>
              <div style={{fontSize:11,fontWeight:600,color:"#fff",marginBottom:3,lineHeight:1.3,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{s.title||s.body?.slice(0,80)}</div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:6}}>
                <span style={{fontSize:13,fontWeight:700,color:s.chartColor,fontFamily:"'JetBrains Mono',monospace"}}>{s.metric?.value||s.position?.pnl||""}</span>
                <Spark data={s.chart} color={s.chartColor} w={50} h={18} type={s.chartType}/>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 400px",minHeight:"calc(100vh - 180px)"}}>
        <div style={{padding:"14px 20px 80px 24px",borderRight:"1px solid rgba(255,255,255,0.04)",overflowY:"auto",maxHeight:"calc(100vh - 180px)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <div style={{display:"flex",gap:5}}>
              {[{k:"all",l:"For you"},{k:"signals",l:"Signals"},{k:"community",l:"Community"},{k:"building",l:"Building"}].map(t=>(
                <span key={t.k} onClick={()=>setFeedFilter(t.k)} style={{fontSize:11,padding:"4px 12px",borderRadius:7,cursor:"pointer",background:feedFilter===t.k?"rgba(255,255,255,0.06)":"transparent",color:feedFilter===t.k?"#fff":"rgba(255,255,255,0.3)",border:`1px solid ${feedFilter===t.k?"rgba(255,255,255,0.08)":"transparent"}`,fontWeight:feedFilter===t.k?500:400}}>{t.l}</span>
              ))}
            </div>
            {activeSector && (
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:10,padding:"3px 8px",borderRadius:5,background:S[activeSector].color+"18",color:S[activeSector].color,fontWeight:500}}>{S[activeSector].label}</span>
                <span onClick={()=>setActiveSector(null)} style={{fontSize:10,color:"#8B5CF6",cursor:"pointer"}}>Clear</span>
              </div>
            )}
          </div>
          {filteredFeed.map((item,i)=><FeedItem key={item.id} item={item} idx={i}/>)}
          <div style={{textAlign:"center",padding:"28px 0",color:"rgba(255,255,255,0.12)",fontSize:11}}>Feed refreshes automatically</div>
        </div>

        <div style={{display:"flex",flexDirection:"column",overflowY:"auto",maxHeight:"calc(100vh - 180px)"}}>
          <div style={{display:"flex",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
            {[{k:"protocol",l:"Connection Protocol"},{k:"match",l:"Find audience"}].map(t=>(
              <span key={t.k} onClick={()=>setRightTab(t.k)} style={{flex:1,padding:"10px 0",textAlign:"center",fontSize:11,cursor:"pointer",
                color:rightTab===t.k?"#fff":"rgba(255,255,255,0.3)",borderBottom:`2px solid ${rightTab===t.k?"#8B5CF6":"transparent"}`,fontWeight:rightTab===t.k?500:400,transition:"all 0.2s"}}>{t.l}</span>
            ))}
          </div>
          {rightTab === "protocol" && <ConnectionProtocol activeSector={activeSector} setActiveSector={setActiveSector} />}
          {rightTab === "match" && <MatchMaker />}
        </div>
      </div>
    </div>
  );
}
