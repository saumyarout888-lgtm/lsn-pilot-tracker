import { useState } from "react";

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const ADMIN_PIN = "0000"; // ← change this
const SHEET_URL = "PASTE_YOUR_APPS_SCRIPT_URL_HERE";

const VH_CFG = {
  "VH-01":{ type:"e3W", model:"Van+DCD",         oem:"OSM/Piaggio", vendor:"Wikilabs", mg:650, da:false },
  "VH-02":{ type:"e3W", model:"Van+DCD",         oem:"OSM/Piaggio", vendor:"Wikilabs", mg:650, da:false },
  "VH-03":{ type:"e4W", model:"Van+Driver Only", oem:"Tata Ace EV", vendor:"Gentari",  mg:800, da:false },
  "VH-04":{ type:"e4W", model:"Van+Driver+DA",   oem:"Tata Ace EV", vendor:"Gentari",  mg:850, da:true  },
  "VH-05":{ type:"e4W", model:"Van+Driver+DA",   oem:"Tata Ace EV", vendor:"Gentari",  mg:850, da:true  },
};

// Default hub: each vehicle starts pointing to the DMart hub placeholder
const INIT_HUBS = Object.keys(VH_CFG).map(id=>({
  vehicleId: id,
  name: "DMart Hub",
  lat: "19.0760",
  lng: "72.8777",
  radius: "500",
}));

const INIT_VEHICLES = Object.entries(VH_CFG).map(([id,c])=>({
  id, type:c.type, model:c.model, oem:c.oem, vendor:c.vendor,
  vendorContact:c.vendor==="Gentari"?"Gentari Helpdesk":"",
  regNo:"", driver:"", driverPhone:"", da:c.da?"":"-", daPhone:"", status:"Active",
}));

const INIT_ROSTER = [
  {empId:"DRV-01",name:"",role:"Driver",             vehicle:"VH-01",vendor:"Wikilabs",phone:"",emergency:"",trained:"Y",trainingDate:"09-Apr-2026",status:"Active"},
  {empId:"DRV-02",name:"",role:"Driver",             vehicle:"VH-02",vendor:"Wikilabs",phone:"",emergency:"",trained:"Y",trainingDate:"09-Apr-2026",status:"Active"},
  {empId:"DRV-03",name:"",role:"Driver",             vehicle:"VH-03",vendor:"Gentari", phone:"",emergency:"",trained:"Y",trainingDate:"09-Apr-2026",status:"Active"},
  {empId:"DRV-04",name:"",role:"Driver",             vehicle:"VH-04",vendor:"Gentari", phone:"",emergency:"",trained:"Y",trainingDate:"09-Apr-2026",status:"Active"},
  {empId:"DRV-05",name:"",role:"Driver",             vehicle:"VH-05",vendor:"Gentari", phone:"",emergency:"",trained:"Y",trainingDate:"09-Apr-2026",status:"Active"},
  {empId:"DA-01", name:"",role:"Delivery Associate", vehicle:"VH-04",vendor:"Gentari", phone:"",emergency:"",trained:"Y",trainingDate:"09-Apr-2026",status:"Active"},
  {empId:"DA-02", name:"",role:"Delivery Associate", vehicle:"VH-05",vendor:"Gentari", phone:"",emergency:"",trained:"Y",trainingDate:"09-Apr-2026",status:"Active"},
  {empId:"DA-03", name:"",role:"Extra DA",           vehicle:"TBD",  vendor:"Gentari", phone:"",emergency:"",trained:"", trainingDate:"TBD",         status:"Pending"},
  {empId:"DA-04", name:"",role:"Extra DA",           vehicle:"TBD",  vendor:"Gentari", phone:"",emergency:"",trained:"", trainingDate:"TBD",         status:"Pending"},
  {empId:"BUF-01",name:"",role:"Buffer/Spare Driver",vehicle:"All",  vendor:"Wikilabs",phone:"",emergency:"",trained:"Y",trainingDate:"09-Apr-2026",status:"Active"},
];
// ─────────────────────────────────────────────────────────────────────────────

// ── Helpers ──────────────────────────────────────────────────────────────────
function haversine(a,b,c,d){
  const R=6371000,r=x=>x*Math.PI/180,dl=r(c-a),dn=r(d-b);
  const x=Math.sin(dl/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(dn/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
function checkAtHub(hub){
  const lat=parseFloat(hub.lat), lng=parseFloat(hub.lng), radius=parseFloat(hub.radius)||500;
  return new Promise((ok,fail)=>{
    if(!navigator.geolocation){fail("Geolocation not supported.");return;}
    navigator.geolocation.getCurrentPosition(
      ({coords})=>{
        const d=haversine(coords.latitude,coords.longitude,lat,lng);
        d<=radius?ok():fail(`Must be at ${hub.name||"Hub"} (${Math.round(d)}m away, allowed: ${radius}m)`);
      },
      ()=>fail("Location access denied. Please allow location."),
      {enableHighAccuracy:true,timeout:10000}
    );
  });
}
function postSheet(data){
  if(SHEET_URL.startsWith("PASTE"))return Promise.resolve();
  return fetch(SHEET_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data),mode:"no-cors"});
}
const fmtT=(d)=>d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:false});
const fmtD=(d)=>d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}).replace(/ /g,"-");
const today=()=>fmtD(new Date());

function useLS(key,init){
  const [v,setV]=useState(()=>{
    try{const s=localStorage.getItem(key);return s?JSON.parse(s):init;}catch{return init;}
  });
  const save=(val)=>{setV(val);localStorage.setItem(key,JSON.stringify(val));};
  return [v,save];
}

// ── Inline Icons ──────────────────────────────────────────────────────────────
const Ico={
  check:  (p)=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={p?.cls??"w-6 h-6"}><circle cx="12" cy="12" r="10"/><path d="M7 12.5l3.5 3.5 6.5-7"/></svg>,
  alert:  ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  spin:   ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6 animate-spin"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity="0.25"/><path d="M21 12a9 9 0 00-9-9"/></svg>,
  login:  ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>,
  logout: ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  zap:    (p)=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-5 h-5 ${p?.on?"text-yellow-500":"text-gray-400"}`}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  pin:    (p)=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p?.cls??"w-4 h-4"}><path d="M21 10c0 6-9 13-9 13S3 16 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  edit:   ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  plus:   ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  back:   ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><polyline points="15 18 9 12 15 6"/></svg>,
  close:  ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  truck:  ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  user:   ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  list:   ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  shield: ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  locate: ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="9" strokeDasharray="2 3"/></svg>,
};

// ── Shared UI ─────────────────────────────────────────────────────────────────
function Header({title,sub,onBack}){
  return(
    <header className="bg-gray-900 px-4 py-3.5 flex items-center gap-3 shrink-0">
      {onBack&&<button onClick={onBack} className="text-gray-400 hover:text-white mr-1"><Ico.back/></button>}
      <span className="text-green-400 font-black text-2xl tracking-tight">LSN</span>
      <div className="border-l border-gray-600 pl-3">
        <p className="text-white font-semibold text-sm leading-tight">{title}</p>
        <p className="text-gray-400 text-xs">{sub}</p>
      </div>
    </header>
  );
}
function ErrBox({msg}){
  if(!msg)return null;
  return(
    <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
      <span className="text-red-500"><Ico.alert/></span>
      <p className="text-red-700 text-sm">{msg}</p>
    </div>
  );
}
function Pill({label,color}){
  const map={green:"bg-green-100 text-green-700",blue:"bg-blue-100 text-blue-700",orange:"bg-orange-100 text-orange-700",red:"bg-red-100 text-red-700",gray:"bg-gray-100 text-gray-600",yellow:"bg-yellow-100 text-yellow-700"};
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[color]||map.gray}`}>{label}</span>;
}
function Btn({children,onClick,color="green",disabled,full,sm}){
  const base="font-bold rounded-2xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50";
  const sz=sm?"px-4 py-2 text-sm":"py-4 text-base";
  const w=full?"w-full":"";
  const c={green:"bg-green-500 hover:bg-green-600 text-white",red:"bg-red-500 hover:bg-red-600 text-white",dark:"bg-gray-900 hover:bg-gray-700 text-white",gray:"bg-gray-100 hover:bg-gray-200 text-gray-700",blue:"bg-blue-500 hover:bg-blue-600 text-white"};
  return<button onClick={onClick} disabled={disabled} className={`${base} ${sz} ${w} ${c[color]||c.green}`}>{children}</button>;
}
function Field({label,value,onChange,type="text",required,placeholder,opts,hint}){
  const cls="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-400 bg-white";
  return(
    <div>
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">{label}{required&&<span className="text-red-500 ml-0.5">*</span>}</label>
      {opts
        ?<select value={value} onChange={e=>onChange(e.target.value)} className={cls}>
           {opts.map(o=><option key={o} value={o}>{o}</option>)}
         </select>
        :<input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder||""} className={cls}/>
      }
      {hint&&<p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}
function Modal({title,onClose,children,onSave,saveLabel="Save"}){
  return(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-t-2xl max-h-[90vh] flex flex-col" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><Ico.close/></button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-3">{children}</div>
        {onSave&&<div className="px-5 py-4 border-t border-gray-100"><Btn full color="dark" onClick={onSave}>{saveLabel}</Btn></div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — HUB LOCATIONS TAB
// ─────────────────────────────────────────────────────────────────────────────
function HubTab({hubs,setHubs}){
  const [modal,setModal]=useState(null); // index
  const [form,setForm]=useState({});
  const [locating,setLocating]=useState(false);
  const [locErr,setLocErr]=useState("");
  const f=(k)=>v=>setForm(p=>({...p,[k]:v}));

  function open(idx){setForm({...hubs[idx]});setLocErr("");setModal(idx);}
  function save(){
    if(!form.lat||!form.lng||isNaN(parseFloat(form.lat))||isNaN(parseFloat(form.lng))){
      setLocErr("Please enter valid latitude and longitude.");return;
    }
    const n=[...hubs];n[modal]=form;setHubs(n);setModal(null);
  }

  // Capture current GPS for admin convenience
  function captureLocation(){
    setLocating(true);setLocErr("");
    navigator.geolocation.getCurrentPosition(
      ({coords})=>{
        setForm(p=>({...p,lat:coords.latitude.toFixed(6),lng:coords.longitude.toFixed(6)}));
        setLocating(false);
      },
      ()=>{setLocErr("Location access denied.");setLocating(false);},
      {enableHighAccuracy:true,timeout:10000}
    );
  }

  function mapsUrl(h){
    return `https://www.google.com/maps?q=${h.lat},${h.lng}`;
  }

  const isConfigured=(h)=>h.lat!=="19.0760"||h.lng!=="72.8777";

  return(
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
        <p className="text-xs text-blue-700 font-medium">Set the pickup/hub location for each vehicle. Drivers can only sign in within the allowed radius.</p>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
        {hubs.map((h,i)=>(
          <div key={h.vehicleId} className="px-4 py-3.5 hover:bg-gray-50 cursor-pointer flex items-start justify-between" onClick={()=>open(i)}>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-900">{h.vehicleId}</span>
                <Pill label={VH_CFG[h.vehicleId]?.type||""} color="blue"/>
                {isConfigured(h)
                  ?<Pill label="Hub Set ✓" color="green"/>
                  :<Pill label="Default" color="yellow"/>
                }
              </div>
              <p className="text-sm font-medium text-gray-700 mt-0.5">{h.name||"Unnamed Hub"}</p>
              <div className="flex gap-3 mt-1 text-xs text-gray-500">
                <span className="flex items-center gap-0.5"><Ico.pin cls="w-3 h-3"/> {parseFloat(h.lat).toFixed(4)}, {parseFloat(h.lng).toFixed(4)}</span>
                <span>⊙ {h.radius}m radius</span>
              </div>
            </div>
            <span className="text-gray-400 ml-2 mt-0.5"><Ico.edit/></span>
          </div>
        ))}
      </div>

      {modal!==null&&(
        <Modal title={`Hub Location — ${form.vehicleId}`} onClose={()=>setModal(null)} onSave={save} saveLabel="Save Hub">
          <Field label="Hub / Location Name" value={form.name||""} onChange={f("name")} placeholder="e.g. DMart Andheri Hub" required/>

          <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">GPS Coordinates</p>
              <Btn sm color="blue" onClick={captureLocation} disabled={locating}>
                {locating?<><Ico.spin/> Locating…</>:<><Ico.locate/> Use My Location</>}
              </Btn>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Latitude" value={form.lat||""} onChange={f("lat")} placeholder="19.0760" hint="e.g. 19.0760"/>
              <Field label="Longitude" value={form.lng||""} onChange={f("lng")} placeholder="72.8777" hint="e.g. 72.8777"/>
            </div>
            <Field label="Allowed Radius (meters)" value={form.radius||"500"} onChange={f("radius")} type="number" hint="Drivers must be within this distance to sign in"/>
          </div>

          {form.lat&&form.lng&&!isNaN(parseFloat(form.lat))&&(
            <a href={`https://www.google.com/maps?q=${form.lat},${form.lng}`} target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-2 text-blue-600 text-sm font-semibold border border-blue-200 rounded-xl py-2.5 hover:bg-blue-50 transition-colors">
              <Ico.pin cls="w-4 h-4"/> Verify on Google Maps ↗
            </a>
          )}

          <ErrBox msg={locErr}/>

          <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2.5">
            <p className="text-xs text-yellow-800"><strong>Tip:</strong> Go to the hub location on your phone, then tap "Use My Location" to auto-fill the exact coordinates.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — DAILY OPS LOG
// ─────────────────────────────────────────────────────────────────────────────
function OpsLogTab({log,setLog}){
  const BLANK={date:today(),vehicleId:"VH-01",type:"e3W",driverName:"",daName:"-",shiftStart:"06:00",shiftEnd:"18:00",driverPresent:"Y",daPresent:"-",parcels:"",mgTarget:"650",mgMet:"",charging:"Y",notes:""};
  const [modal,setModal]=useState(null);
  const [form,setForm]=useState({});
  const f=(k)=>v=>setForm(p=>({...p,[k]:v}));

  function openAdd(){setForm({...BLANK});setModal({mode:"add"});}
  function openEdit(idx){setForm({...log[idx]});setModal({mode:"edit",idx});}
  function save(){
    const mgMet=form.parcels!==""?(Number(form.parcels)>=(Number(form.mgTarget)||0)?"Y":"N"):"";
    const entry={...form,mgMet};
    if(modal.mode==="add"){setLog([...log,entry]);}
    else{const n=[...log];n[modal.idx]=entry;setLog(n);}
    setModal(null);
  }
  function del(){const n=log.filter((_,i)=>i!==modal.idx);setLog(n);setModal(null);}

  function onVehChange(v){
    const c=VH_CFG[v];
    setForm(p=>({...p,vehicleId:v,type:c?.type||"",mgTarget:String(c?.mg||""),daPresent:c?.da?"Y":"-"}));
  }

  return(
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
        <p className="text-sm text-gray-500">{log.length} entries</p>
        <Btn sm color="dark" onClick={openAdd}><Ico.plus/> Add Entry</Btn>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
        {log.length===0&&<p className="text-center text-gray-400 py-12 text-sm">No log entries yet</p>}
        {[...log].reverse().map((e,ri)=>{
          const idx=log.length-1-ri;
          return(
            <div key={idx} className="px-4 py-3 hover:bg-gray-50 cursor-pointer" onClick={()=>openEdit(idx)}>
              <div className="flex justify-between items-start">
                <div>
                  <span className="font-bold text-gray-900 text-sm">{e.vehicleId}</span>
                  <span className="text-gray-400 text-xs ml-2">{e.date}</span>
                </div>
                <div className="flex gap-1.5 flex-wrap justify-end">
                  <Pill label={e.type} color="blue"/>
                  {e.mgMet==="Y"&&<Pill label="MG ✓" color="green"/>}
                  {e.mgMet==="N"&&<Pill label="MG ✗" color="red"/>}
                </div>
              </div>
              <div className="flex gap-3 mt-1 text-xs text-gray-500">
                <span>{e.shiftStart}–{e.shiftEnd}</span>
                {e.driverName&&<span>👤 {e.driverName}</span>}
                {e.parcels!==""&&<span>📦 {e.parcels}/{e.mgTarget}</span>}
                {e.charging==="Y"&&<span>⚡ Charged</span>}
              </div>
              {e.notes&&<p className="text-xs text-orange-600 mt-1 truncate">⚠ {e.notes}</p>}
            </div>
          );
        })}
      </div>

      {modal&&(
        <Modal title={modal.mode==="add"?"Add Log Entry":"Edit Log Entry"} onClose={()=>setModal(null)} onSave={save}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" value={form.date||""} onChange={f("date")} placeholder="16-Apr-2026"/>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Vehicle ID</label>
              <select value={form.vehicleId||"VH-01"} onChange={e=>onVehChange(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-400 bg-white">
                {Object.keys(VH_CFG).map(v=><option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type" value={form.type||""} onChange={f("type")} opts={["e3W","e4W"]}/>
            <Field label="Shift Start" value={form.shiftStart||""} onChange={f("shiftStart")} placeholder="06:00"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Shift End" value={form.shiftEnd||""} onChange={f("shiftEnd")} placeholder="18:00"/>
            <Field label="Driver Present" value={form.driverPresent||"Y"} onChange={f("driverPresent")} opts={["Y","N"]}/>
          </div>
          <Field label="Driver Name" value={form.driverName||""} onChange={f("driverName")} placeholder="Full name"/>
          <div className="grid grid-cols-2 gap-3">
            <Field label="DA Present" value={form.daPresent||"-"} onChange={f("daPresent")} opts={["Y","N","-"]}/>
            <Field label="DA Name" value={form.daName||""} onChange={f("daName")} placeholder="Name or -"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Parcels Delivered" value={form.parcels||""} onChange={f("parcels")} type="number" placeholder="0"/>
            <Field label="MG Target" value={form.mgTarget||""} onChange={f("mgTarget")} type="number"/>
          </div>
          <Field label="Charging Done" value={form.charging||"Y"} onChange={f("charging")} opts={["Y","N"]}/>
          <Field label="Incidents / Notes" value={form.notes||""} onChange={f("notes")} placeholder="Optional"/>
          {modal.mode==="edit"&&<button onClick={del} className="text-red-500 text-sm font-semibold text-center py-1 hover:underline">Delete Entry</button>}
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — VEHICLE REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
function VehicleTab({vehicles,setVehicles}){
  const [modal,setModal]=useState(null);
  const [form,setForm]=useState({});
  const f=(k)=>v=>setForm(p=>({...p,[k]:v}));
  function open(idx){setForm({...vehicles[idx]});setModal(idx);}
  function save(){const n=[...vehicles];n[modal]=form;setVehicles(n);setModal(null);}

  const statusColor={Active:"green",Inactive:"red",Maintenance:"yellow"};
  return(
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
        {vehicles.map((v,i)=>(
          <div key={v.id} className="px-4 py-3.5 hover:bg-gray-50 cursor-pointer flex items-start justify-between" onClick={()=>open(i)}>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-900">{v.id}</span>
                <Pill label={v.type} color="blue"/>
                <Pill label={v.status} color={statusColor[v.status]||"gray"}/>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{v.model} · {v.oem} · {v.vendor}</p>
              <div className="flex gap-3 mt-1 text-xs text-gray-600">
                {v.driver&&<span>👤 {v.driver}</span>}
                {v.regNo&&<span>🚘 {v.regNo}</span>}
                {v.da&&v.da!=="-"&&<span>🤝 DA: {v.da}</span>}
              </div>
            </div>
            <span className="text-gray-400 ml-2 mt-0.5"><Ico.edit/></span>
          </div>
        ))}
      </div>
      {modal!==null&&(
        <Modal title={`Edit ${form.id}`} onClose={()=>setModal(null)} onSave={save}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type" value={form.type||""} onChange={f("type")} opts={["e3W","e4W"]}/>
            <Field label="Status" value={form.status||"Active"} onChange={f("status")} opts={["Active","Inactive","Maintenance"]}/>
          </div>
          <Field label="Registration No." value={form.regNo||""} onChange={f("regNo")} placeholder="MH XX XX XXXX"/>
          <Field label="OEM" value={form.oem||""} onChange={f("oem")}/>
          <Field label="Vendor" value={form.vendor||""} onChange={f("vendor")}/>
          <Field label="Vendor Contact" value={form.vendorContact||""} onChange={f("vendorContact")}/>
          <Field label="Driver Assigned" value={form.driver||""} onChange={f("driver")} placeholder="Driver name"/>
          <Field label="Driver Phone" value={form.driverPhone||""} onChange={f("driverPhone")} type="tel"/>
          <Field label="DA Assigned" value={form.da||""} onChange={f("da")} placeholder="DA name or -"/>
          <Field label="DA Phone" value={form.daPhone||""} onChange={f("daPhone")} type="tel"/>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — ROSTER
// ─────────────────────────────────────────────────────────────────────────────
function RosterTab({roster,setRoster}){
  const BLANK={empId:"",name:"",role:"Driver",vehicle:"VH-01",vendor:"Wikilabs",phone:"",emergency:"",trained:"",trainingDate:"",status:"Active"};
  const [modal,setModal]=useState(null);
  const [form,setForm]=useState({});
  const f=(k)=>v=>setForm(p=>({...p,[k]:v}));
  function openAdd(){setForm({...BLANK});setModal("add");}
  function openEdit(idx){setForm({...roster[idx]});setModal(idx);}
  function save(){
    if(modal==="add"){setRoster([...roster,form]);}
    else{const n=[...roster];n[modal]=form;setRoster(n);}
    setModal(null);
  }
  function del(){const n=roster.filter((_,i)=>i!==modal);setRoster(n);setModal(null);}

  const roleColor={"Driver":"blue","Delivery Associate":"orange","Extra DA":"yellow","Buffer/Spare Driver":"gray"};
  const statusColor={Active:"green",Pending:"yellow",Inactive:"red"};
  return(
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
        <p className="text-sm text-gray-500">{roster.length} members</p>
        <Btn sm color="dark" onClick={openAdd}><Ico.plus/> Add Member</Btn>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
        {roster.map((r,i)=>(
          <div key={r.empId||i} className="px-4 py-3.5 hover:bg-gray-50 cursor-pointer flex items-start justify-between" onClick={()=>openEdit(i)}>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-gray-900 text-sm">{r.empId}</span>
                {r.name&&<span className="text-gray-700 text-sm">{r.name}</span>}
                <Pill label={r.role} color={roleColor[r.role]||"gray"}/>
                <Pill label={r.status} color={statusColor[r.status]||"gray"}/>
              </div>
              <div className="flex gap-3 mt-1 text-xs text-gray-500">
                <span>🚗 {r.vehicle}</span>
                <span>🏢 {r.vendor}</span>
                {r.phone&&<span>📞 {r.phone}</span>}
                {r.trained==="Y"&&<span className="text-green-600">✓ Trained {r.trainingDate}</span>}
              </div>
            </div>
            <span className="text-gray-400 ml-2 mt-0.5"><Ico.edit/></span>
          </div>
        ))}
      </div>
      {modal!==null&&(
        <Modal title={modal==="add"?"Add Roster Member":"Edit Member"} onClose={()=>setModal(null)} onSave={save}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Employee ID" value={form.empId||""} onChange={f("empId")} placeholder="DRV-06" required/>
            <Field label="Role" value={form.role||"Driver"} onChange={f("role")} opts={["Driver","Delivery Associate","Extra DA","Buffer/Spare Driver"]}/>
          </div>
          <Field label="Full Name" value={form.name||""} onChange={f("name")} placeholder="Full name"/>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Assigned Vehicle</label>
              <select value={form.vehicle||"VH-01"} onChange={e=>f("vehicle")(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-400 bg-white">
                {[...Object.keys(VH_CFG),"TBD","All"].map(v=><option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <Field label="Vendor" value={form.vendor||""} onChange={f("vendor")} opts={["Wikilabs","Gentari","Other"]}/>
          </div>
          <Field label="Phone Number" value={form.phone||""} onChange={f("phone")} type="tel"/>
          <Field label="Emergency Contact" value={form.emergency||""} onChange={f("emergency")} type="tel"/>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Training Done" value={form.trained||""} onChange={f("trained")} opts={["Y","N",""]}/>
            <Field label="Training Date" value={form.trainingDate||""} onChange={f("trainingDate")} placeholder="09-Apr-2026"/>
          </div>
          <Field label="Status / Notes" value={form.status||"Active"} onChange={f("status")} opts={["Active","Pending","Inactive"]}/>
          {modal!=="add"&&<button onClick={del} className="text-red-500 text-sm font-semibold text-center py-1 hover:underline">Remove Member</button>}
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
function AdminDashboard({onLogout,log,setLog,vehicles,setVehicles,roster,setRoster,hubs,setHubs}){
  const [tab,setTab]=useState("hubs");
  const tabs=[
    {id:"hubs",  icon:<Ico.pin cls="w-6 h-6"/>, label:"Hubs"},
    {id:"ops",   icon:<Ico.list/>,               label:"Daily Log"},
    {id:"veh",   icon:<Ico.truck/>,              label:"Vehicles"},
    {id:"roster",icon:<Ico.user/>,               label:"Roster"},
  ];
  return(
    <div className="w-full max-w-sm min-h-screen flex flex-col bg-white shadow-xl">
      <Header title="Admin Panel" sub="LSN DMart Pilot" onBack={onLogout}/>
      <div className="flex border-b border-gray-200 shrink-0">
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={`flex-1 flex flex-col items-center py-2.5 gap-0.5 text-xs font-semibold transition-colors
              ${tab===t.id?"text-green-600 border-b-2 border-green-500":"text-gray-400 hover:text-gray-600"}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>
      {tab==="hubs"   &&<HubTab    hubs={hubs}       setHubs={setHubs}/>}
      {tab==="ops"    &&<OpsLogTab log={log}          setLog={setLog}/>}
      {tab==="veh"    &&<VehicleTab vehicles={vehicles} setVehicles={setVehicles}/>}
      {tab==="roster" &&<RosterTab  roster={roster}   setRoster={setRoster}/>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN PIN
// ─────────────────────────────────────────────────────────────────────────────
function AdminPin({onSuccess,onBack}){
  const [pin,setPin]=useState("");
  const [err,setErr]=useState("");
  function check(){pin===ADMIN_PIN?onSuccess():setErr("Incorrect PIN. Try again.");}
  return(
    <div className="w-full max-w-sm min-h-screen flex flex-col bg-white shadow-xl">
      <Header title="Admin Login" sub="Enter PIN to continue" onBack={onBack}/>
      <div className="flex-1 flex flex-col items-center justify-center px-8 gap-6">
        <div className="bg-gray-100 rounded-2xl p-5 text-gray-700"><Ico.shield/></div>
        <div className="w-full flex flex-col gap-2">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide text-center">Admin PIN</label>
          <input type="password" maxLength={8} value={pin} onChange={e=>{setPin(e.target.value);setErr("");}}
            onKeyDown={e=>e.key==="Enter"&&check()} placeholder="••••"
            className="w-full border-2 border-gray-200 rounded-xl px-4 py-4 text-2xl text-center font-bold tracking-widest focus:outline-none focus:border-green-400"/>
        </div>
        <Btn full onClick={check}><Ico.check/> Unlock</Btn>
        <ErrBox msg={err}/>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DRIVER APP
// ─────────────────────────────────────────────────────────────────────────────
const DRV_INIT={screen:"login",vehicleId:"VH-01",driverName:"",daName:"",shiftStart:null,shiftEnd:null,parcels:"",charging:false,error:"",loading:false};

function DriverApp({onBack,addLog,hubs}){
  const [s,setS]=useState(DRV_INIT);
  const set=(p)=>setS(v=>({...v,...p}));
  const vcfg=VH_CFG[s.vehicleId];
  const hubForVehicle=()=>hubs.find(h=>h.vehicleId===s.vehicleId)||hubs[0];

  async function handleSignIn(){
    if(!s.driverName.trim()){set({error:"Enter Driver Name."});return;}
    if(vcfg.da&&!s.daName.trim()){set({error:`DA Name required for ${s.vehicleId}`});return;}
    set({loading:true,error:""});
    try{
      await checkAtHub(hubForVehicle());
      const start=new Date();
      await postSheet({vid:s.vehicleId,type:vcfg.type,driver:s.driverName.trim(),da:vcfg.da?s.daName.trim():"-",start:fmtT(start),end:"",parcels:"",charging:"",status:"Active",date:fmtD(start)});
      set({loading:false,shiftStart:start,screen:"signed-in"});
    }catch(e){set({loading:false,error:String(e)});}
  }
  async function handleSignOut(){
    set({loading:true,error:""});
    try{await checkAtHub(hubForVehicle());set({loading:false,screen:"signout-form"});}
    catch(e){set({loading:false,error:String(e)});}
  }
  function handleSubmit(){
    if(!s.parcels||isNaN(+s.parcels)||+s.parcels<0){set({error:"Enter valid parcel count."});return;}
    const end=new Date();
    const entry={date:fmtD(s.shiftStart),vehicleId:s.vehicleId,type:vcfg.type,driverName:s.driverName.trim(),daName:vcfg.da?s.daName.trim():"-",shiftStart:fmtT(s.shiftStart),shiftEnd:fmtT(end),driverPresent:"Y",daPresent:vcfg.da?"Y":"-",parcels:s.parcels,mgTarget:String(vcfg.mg),mgMet:+s.parcels>=vcfg.mg?"Y":"N",charging:s.charging?"Y":"N",notes:""};
    postSheet({...entry,status:"Complete"});
    addLog(entry);
    console.log("LSN DMart Log:",JSON.stringify(entry,null,2));
    set({shiftEnd:end,screen:"success",error:""});
  }

  const hub=hubForVehicle();
  const logEntry=s.shiftEnd?{"Date":fmtD(s.shiftStart),"Vehicle":s.vehicleId,"Type":vcfg.type,"Driver":s.driverName,"DA":vcfg.da?s.daName:"-","Start":fmtT(s.shiftStart),"End":fmtT(s.shiftEnd),"Parcels":s.parcels,"MG":vcfg.mg,"MG Met":+s.parcels>=vcfg.mg?"Y":"N","Charging":s.charging?"Y":"N"}:null;

  return(
    <div className="w-full max-w-sm min-h-screen flex flex-col bg-white shadow-xl">
      <Header title="DMart Pilot" sub="Driver App" onBack={onBack}/>
      <main className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-4">

        {s.screen==="login"&&<>
          <div className="flex items-center gap-2 text-gray-500 text-sm"><Ico.pin/><span>Sign-in requires Hub location</span></div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Vehicle ID</label>
            <select value={s.vehicleId} onChange={e=>set({vehicleId:e.target.value,daName:"",error:""})}
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3.5 text-xl font-bold text-gray-800 bg-gray-50 focus:outline-none focus:border-green-400">
              {Object.keys(VH_CFG).map(v=><option key={v} value={v}>{v}</option>)}
            </select>
            <div className="flex gap-2 mt-2 flex-wrap">
              <Pill label={vcfg.type} color="blue"/>
              <Pill label={vcfg.vendor} color="gray"/>
              {vcfg.da&&<Pill label="DA Required" color="orange"/>}
              <Pill label={`MG: ${vcfg.mg}`} color="green"/>
            </div>
            {/* Show which hub will be checked */}
            <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              <Ico.pin cls="w-3.5 h-3.5 text-green-500 shrink-0"/>
              <span>Check-in point: <strong className="text-gray-700">{hub.name}</strong> · {hub.radius}m radius</span>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Driver Name</label>
            <input value={s.driverName} onChange={e=>set({driverName:e.target.value,error:""})} placeholder="Enter your name"
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3.5 text-base font-semibold text-gray-800 bg-gray-50 focus:outline-none focus:border-green-400"/>
          </div>
          {vcfg.da&&<div>
            <label className="text-xs font-semibold text-orange-600 uppercase tracking-wide block mb-1.5">DA Name *</label>
            <input value={s.daName} onChange={e=>set({daName:e.target.value,error:""})} placeholder="Enter DA name"
              className="w-full border-2 border-orange-200 rounded-xl px-4 py-3.5 text-base font-semibold text-gray-800 bg-orange-50 focus:outline-none focus:border-orange-400"/>
          </div>}
          <Btn full onClick={handleSignIn} disabled={s.loading}>
            {s.loading?<><Ico.spin/> Verifying Location…</>:<><Ico.login/> Sign In</>}
          </Btn>
          <ErrBox msg={s.error}/>
        </>}

        {s.screen==="signed-in"&&<>
          <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-4">
            <p className="text-xs font-semibold text-green-600 uppercase tracking-wide">Active Shift</p>
            <p className="text-2xl font-black text-gray-900">{s.vehicleId} <span className="text-sm font-semibold text-blue-600">{vcfg.type}</span></p>
            <p className="text-sm text-gray-700 font-medium mt-0.5">{s.driverName}{vcfg.da&&s.daName?` + DA: ${s.daName}`:""}</p>
            <p className="text-sm text-gray-500">Started <span className="font-semibold text-gray-700">{s.shiftStart&&fmtT(s.shiftStart)}</span> · MG: <strong>{vcfg.mg}</strong></p>
          </div>
          <div className="flex-1 flex flex-col justify-end gap-3 mt-auto">
            <p className="text-center text-gray-400 text-sm">Return to <strong>{hub.name}</strong> before signing out</p>
            <Btn full color="red" onClick={handleSignOut} disabled={s.loading}>
              {s.loading?<><Ico.spin/> Verifying Location…</>:<><Ico.logout/> Sign Out</>}
            </Btn>
            <ErrBox msg={s.error}/>
          </div>
        </>}

        {s.screen==="signout-form"&&<>
          <p className="text-gray-500 text-sm">End of shift — <strong>{s.vehicleId}</strong> · {s.driverName} · MG: <strong>{vcfg.mg}</strong></p>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Parcels Delivered</label>
            <input type="number" inputMode="numeric" min="0" placeholder="0" value={s.parcels}
              onChange={e=>set({parcels:e.target.value,error:""})}
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-4 text-4xl font-black text-center text-gray-800 bg-gray-50 focus:outline-none focus:border-green-400"/>
            {s.parcels&&<p className={`text-center text-sm font-semibold mt-1 ${+s.parcels>=vcfg.mg?"text-green-600":"text-orange-500"}`}>
              {+s.parcels>=vcfg.mg?"✓ MG Target Met":"⚠ Below MG Target"} ({vcfg.mg} required)
            </p>}
          </div>
          <div className="flex items-center justify-between bg-gray-50 border-2 border-gray-200 rounded-2xl px-5 py-4">
            <div className="flex items-center gap-2"><Ico.zap on={s.charging}/><span className="font-semibold text-gray-800">Charging Done?</span></div>
            <button onClick={()=>set({charging:!s.charging})}
              className={`relative w-16 h-9 rounded-full transition-colors ${s.charging?"bg-green-500":"bg-gray-300"}`}>
              <span className={`absolute top-1 w-7 h-7 bg-white rounded-full shadow transition-transform ${s.charging?"translate-x-8":"translate-x-1"}`}/>
            </button>
          </div>
          <Btn full color="dark" onClick={handleSubmit} disabled={s.loading}>
            {s.loading?<><Ico.spin/> Saving…</>:<><Ico.check/> Submit &amp; Log</>}
          </Btn>
          <ErrBox msg={s.error}/>
        </>}

        {s.screen==="success"&&logEntry&&<>
          <div className="flex flex-col items-center gap-2 py-4">
            <Ico.check cls="w-14 h-14 text-green-500"/>
            <p className="text-xl font-black text-gray-900">Shift Logged!</p>
            <p className="text-sm text-gray-500">Entry saved to Daily Ops Log</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden">
            {Object.entries(logEntry).map(([k,v])=>(
              <div key={k} className="flex justify-between px-4 py-2.5 border-b last:border-0 border-gray-200">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{k}</span>
                <span className={`font-bold text-sm ${k==="MG Met"||k==="Charging"?(v==="Y"?"text-green-600":"text-red-500"):"text-gray-800"}`}>{String(v)}</span>
              </div>
            ))}
          </div>
          <Btn full onClick={()=>setS(DRV_INIT)}>New Session</Btn>
        </>}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROLE SELECT
// ─────────────────────────────────────────────────────────────────────────────
function RoleSelect({onDriver,onAdmin}){
  return(
    <div className="w-full max-w-sm min-h-screen flex flex-col bg-white shadow-xl">
      <header className="bg-gray-900 px-5 py-5 text-center">
        <span className="text-green-400 font-black text-4xl tracking-tight">LSN</span>
        <p className="text-white font-semibold mt-1">DMart Pilot</p>
        <p className="text-gray-400 text-xs">Operations Tracker</p>
      </header>
      <div className="flex-1 flex flex-col justify-center px-8 gap-5">
        <p className="text-center text-gray-500 text-sm font-medium">Select your role to continue</p>
        <button onClick={onDriver}
          className="w-full border-2 border-gray-200 hover:border-green-400 hover:bg-green-50 rounded-2xl p-6 flex flex-col items-center gap-3 transition-all group">
          <div className="text-gray-400 group-hover:text-green-500 transition-colors"><Ico.truck/></div>
          <div className="text-center">
            <p className="font-bold text-gray-900">Driver / DA</p>
            <p className="text-xs text-gray-500 mt-0.5">Sign in, log deliveries, sign out</p>
          </div>
        </button>
        <button onClick={onAdmin}
          className="w-full border-2 border-gray-200 hover:border-gray-900 hover:bg-gray-50 rounded-2xl p-6 flex flex-col items-center gap-3 transition-all group">
          <div className="text-gray-400 group-hover:text-gray-900 transition-colors"><Ico.shield/></div>
          <div className="text-center">
            <p className="font-bold text-gray-900">Admin</p>
            <p className="text-xs text-gray-500 mt-0.5">Manage hubs, logs, vehicles &amp; roster</p>
          </div>
        </button>
      </div>
      <p className="text-center text-gray-300 text-xs pb-6">LSN DMart Pilot · Apr 2026</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────────────────────
export default function App(){
  const [screen,setScreen]=useState("role");
  const [log,setLog]           =useLS("lsn_ops_log",    []);
  const [vehicles,setVehicles] =useLS("lsn_vehicles",   INIT_VEHICLES);
  const [roster,setRoster]     =useLS("lsn_roster",     INIT_ROSTER);
  const [hubs,setHubs]         =useLS("lsn_hubs",       INIT_HUBS);

  function addLog(entry){
    setLog(v=>{const n=[...v,entry];localStorage.setItem("lsn_ops_log",JSON.stringify(n));return n;});
  }

  return(
    <div className="min-h-screen bg-gray-100 flex justify-center items-start font-sans">
      {screen==="role"     &&<RoleSelect     onDriver={()=>setScreen("driver")} onAdmin={()=>setScreen("admin-pin")}/>}
      {screen==="admin-pin"&&<AdminPin        onSuccess={()=>setScreen("admin")} onBack={()=>setScreen("role")}/>}
      {screen==="admin"    &&<AdminDashboard  onLogout={()=>setScreen("role")} log={log} setLog={setLog} vehicles={vehicles} setVehicles={setVehicles} roster={roster} setRoster={setRoster} hubs={hubs} setHubs={setHubs}/>}
      {screen==="driver"   &&<DriverApp       onBack={()=>setScreen("role")} addLog={addLog} hubs={hubs}/>}
    </div>
  );
}
