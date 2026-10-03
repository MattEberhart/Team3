'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth-context';
import { api } from './api';

type Listing = {
  id: string; donor: string; title: string; detail: string; quantity: number;
  unit: 'meals' | 'lb' | 'boxes' | 'kg' | 'items' | 'trays'; time: string; distance: number; tone: string;
  readiness: 'Ready to eat' | 'Needs cooking'; category: 'meal' | 'ingredient'; allergens: string; organizationId?: string;
};

export default function SecondServingApp() {
  const auth = useAuth();
  const [role, setRole] = useState<'recipient' | 'donor'>('recipient');
  const [view, setView] = useState<'browse' | 'planner' | 'impact'>('browse');
  const [filter, setFilter] = useState<'all' | 'meal' | 'ingredient'>('all');
  const [listings, setListings] = useState<Listing[]>([]);
  const [selected, setSelected] = useState<Listing | null>(null);
  const [reserveQty, setReserveQty] = useState(1);
  const [confirmation, setConfirmation] = useState<{title:string;quantity:number;code:string;address?:string;pickup?:string} | null>(null);
  const [donationOpen, setDonationOpen] = useState(false);
  const [intakeText, setIntakeText] = useState('');
  const [drafts, setDrafts] = useState<Listing[]>([]);
  const [listening, setListening] = useState(false);
  const [maxStops, setMaxStops] = useState(2);
  const [maxMiles, setMaxMiles] = useState(3);
  const [toast, setToast] = useState('');
  const [agentBusy, setAgentBusy] = useState(false);
  const activeRole = auth.user && auth.profile ? auth.profile.user.accountType : role;
  const visibleListings = useMemo(() => listings.filter(item => item.quantity > 0 && (filter === 'all' || item.category === filter)), [listings, filter]);
  const servings = listings.filter(item=>item.unit==='meals').reduce((total,item)=>total+item.quantity,0);

  useEffect(() => {
    if (!auth.configured) return;
    void api<{items:Array<Record<string, unknown>>}>('/listings').then(({items}) => {
      setListings(items.map((item, index) => ({
        id: String(item.listingId), donor: String(item.organizationName || 'Local kitchen'), title: String(item.title), detail: String(item.description || ''),
        quantity: Number(item.quantityAvailable), unit: (['meals','lb','boxes','kg','items','trays'].includes(String(item.unit)) ? item.unit : 'boxes') as Listing['unit'],
        time: String(item.pickupLabel || 'See pickup details'), distance: Number(item.distanceMiles || 0), tone: ['coral','green','gold','plum','tomato','blue'][index % 6],
        readiness: item.readiness === 'needs_cooking' ? 'Needs cooking' : 'Ready to eat', category: item.category === 'ingredient' ? 'ingredient' : 'meal',
        allergens: Array.isArray(item.allergens) && item.allergens.length ? `Contains: ${item.allergens.join(', ')}` : 'No reported major allergens',
        organizationId: String(item.organizationId || ''),
      })));
    }).catch(() => notify('Live listings are temporarily unavailable.'));
  }, [auth.configured]);

  function notify(message:string) { setToast(message); window.setTimeout(() => setToast(''),2800); }
  async function reserve() {
    if (!selected) return;
    if (auth.configured && !auth.user) { auth.openAuth(); return; }
    const quantity = Math.min(reserveQty,selected.quantity);
    let code=String(Math.floor(1000+Math.random()*9000));
    if (auth.configured) {
      try { const result=await api<{pickupCode:string;pickupAddress?:string;pickupLabel?:string}>('/reservations',{method:'POST',body:JSON.stringify({listingId:selected.id,quantity})});code=result.pickupCode;setConfirmation({title:selected.title,quantity,code,address:result.pickupAddress,pickup:result.pickupLabel}); }
      catch (error) { notify(error instanceof Error ? error.message : 'Reservation failed.'); return; }
    }
    setListings(items => items.map(item => item.id === selected.id ? {...item,quantity:item.quantity-quantity} : item));
    if(!auth.configured)setConfirmation({title:selected.title,quantity,code});
    setSelected(null); setReserveQty(1);
  }
  function startVoice() {
    type Recognition = {continuous:boolean;interimResults:boolean;lang:string;onresult:(event:{results:ArrayLike<{[key:number]:{transcript:string}}>})=>void;onend:()=>void;start:()=>void};
    const Speech = (window as typeof window & {webkitSpeechRecognition?:new()=>Recognition}).webkitSpeechRecognition;
    if (!Speech) { notify('Voice capture is unavailable in this browser. You can type the shift note instead.'); return; }
    const recognition = new Speech(); recognition.continuous=false; recognition.interimResults=false; recognition.lang='en-US';
    recognition.onresult=event=>setIntakeText(event.results[0][0].transcript); recognition.onend=()=>setListening(false);
    setListening(true); recognition.start();
  }
  async function makeDrafts() {
    const text=intakeText.trim();
    if(!text){notify('Describe the food and quantity before creating a draft.');return;}
    const organizationId=auth.profile?.memberships[0]?.organizationId;
    if(auth.configured){
      if(!auth.user){auth.openAuth();return;}
      if(!organizationId){notify('Switch this account to a kitchen profile before posting food.');return;}
      setAgentBusy(true);
      try{
        const result=await api<{items:Array<{title:string;description:string;quantity:number;unit:Listing['unit'];category:'meal'|'ingredient';readiness:'ready_to_eat'|'needs_cooking';allergens:string[];pickup_start?:string;pickup_end?:string;needs_review:string[]}>}>('/agent/extract',{method:'POST',body:JSON.stringify({organizationId,shiftNote:text})});
        setDrafts(result.items.map((item,index)=>({id:`draft-${Date.now()}-${index}`,donor:'Your kitchen',title:item.title,detail:item.description,quantity:item.quantity,unit:item.unit,time:item.pickup_start&&item.pickup_end?`${item.pickup_start}–${item.pickup_end}`:'Pickup time needs review',distance:0,tone:item.category==='meal'?'coral':'green',readiness:item.readiness==='needs_cooking'?'Needs cooking':'Ready to eat',category:item.category,allergens:item.allergens.length?`Contains: ${item.allergens.join(', ')}`:item.needs_review.includes('allergens')?'Allergens need review':'No reported major allergens'})));
      }catch(error){notify(error instanceof Error?error.message:'AI extraction failed.');}
      finally{setAgentBusy(false);}
      return;
    }
    const pickup=text.match(/(?:between|from)\s+([\d:]+)\s*(?:and|to|–|-)\s*([\d:]+)/i);
    const time=pickup?`${pickup[1]}–${pickup[2]}`:'Pickup time needs review';
    const parsed:Listing[]=[];
    const meals=text.match(/(\d+)\s+(?:chicken and rice |boxed |dinner )?(?:boxes|meals)/i);
    const carrots=text.match(/(\d+)\s+(?:pounds|lbs?|lb)\s+of\s+carrots/i);
    const potatoes=text.match(/(\d+)\s+(?:pounds|lbs?|lb)\s+of\s+potatoes/i);
    if(meals) parsed.push({id:`draft-meals-${Date.now()}`,donor:'Your kitchen',title:'Chicken & rice dinner boxes',detail:'Chicken, rice · Review allergens before posting',quantity:Number(meals[1]),unit:'meals',time,distance:.8,tone:'coral',readiness:'Ready to eat',category:'meal',allergens:'Allergens not specified'});
    if(carrots||potatoes){const parts=[carrots&&`${carrots[1]} lb carrots`,potatoes&&`${potatoes[1]} lb potatoes`].filter(Boolean);parsed.push({id:`draft-produce-${Date.now()}`,donor:'Your kitchen',title:'Carrots & potatoes',detail:parts.join(' · '),quantity:Number(carrots?.[1]||0)+Number(potatoes?.[1]||0),unit:'lb',time,distance:.8,tone:'green',readiness:'Needs cooking',category:'ingredient',allergens:'No allergens entered'});}
    if(!parsed.length){notify('No quantity and food type were found. Add those details and try again.');return;}
    setDrafts(parsed);
  }
  async function publishDrafts(){
    const organizationId=auth.profile?.memberships[0]?.organizationId;
    let publishedDrafts=drafts;
    if(auth.configured&&organizationId){
      setAgentBusy(true);
      try{
        const pickupEnd=new Date(Date.now()+2*60*60*1000).toISOString();
        const created=await Promise.all(drafts.map(draft=>api<Record<string,unknown>>('/listings',{method:'POST',body:JSON.stringify({organizationId,title:draft.title,description:draft.detail,quantityAvailable:draft.quantity,unit:draft.unit,category:draft.category,readiness:draft.readiness==='Needs cooking'?'needs_cooking':'ready_to_eat',allergens:draft.allergens.startsWith('Contains:')?draft.allergens.replace('Contains:','').split(',').map(value=>value.trim()):[],pickupEnd,pickupLabel:draft.time})})));
        publishedDrafts=drafts.map((draft,index)=>({...draft,id:String(created[index].listingId),organizationId}));
      }catch(error){notify(error instanceof Error?error.message:'Publishing failed.');setAgentBusy(false);return;}
      setAgentBusy(false);
    }
    setListings(items=>[...publishedDrafts,...items]);setDrafts([]);setIntakeText('');setDonationOpen(false);setRole('donor');notify(`${publishedDrafts.length} donation${publishedDrafts.length===1?'':'s'} published.`);
  }
  function closeDonation(){setDonationOpen(false);setDrafts([]);setIntakeText('');}

  return <main className="app-shell" id="top">
    <header className="topbar">
      <button className="brand reset-button" onClick={()=>{setView('browse');if(!auth.user)setRole('recipient')}} aria-label="Second Serving home"><span className="brand-mark">2</span><span>Second Serving</span></button>
      <nav aria-label="Primary navigation"><button className={`nav-link reset-button ${view==='browse'?'active':''}`} onClick={()=>setView('browse')}>Find food</button><button className={`nav-link reset-button ${view==='planner'?'active':''}`} onClick={()=>setView('planner')}>Meal planner <span className="new-dot">AI</span></button><button className={`nav-link reset-button ${view==='impact'?'active':''}`} onClick={()=>setView('impact')}>Impact</button></nav>
      <div className="topbar-actions">{!auth.user&&<div className="role-switch" aria-label="Preview role"><button className={role==='recipient'?'active':''} onClick={()=>setRole('recipient')}>Recipient</button><button className={role==='donor'?'active':''} onClick={()=>setRole('donor')}>Kitchen</button></div>}{auth.configured && (auth.user ? <button className="account-button" onClick={() => void auth.logout()}>Sign out</button> : <button className="account-button" onClick={auth.openAuth}>Sign in</button>)}</div>
    </header>
    {activeRole==='donor'
      ? <DonorDashboard listings={listings} organizationId={auth.profile?.memberships[0]?.organizationId} onPost={()=>setDonationOpen(true)} onSwitch={()=>setRole('recipient')} showSwitch={!auth.user} notify={notify}/>
      : view==='planner'
        ? <Planner listingCount={listings.filter(item=>item.category==='ingredient').length} maxStops={maxStops} setMaxStops={setMaxStops} maxMiles={maxMiles} setMaxMiles={setMaxMiles} onBack={()=>setView('browse')}/>
        : view==='impact'
          ? <Impact servings={servings} onBack={()=>setView('browse')}/>
          : <Browse listings={listings} visibleListings={visibleListings} servings={servings} filter={filter} setFilter={setFilter} openPlanner={()=>setView('planner')} select={listing=>{setSelected(listing);setReserveQty(1)}} openDonation={()=>setDonationOpen(true)}/>}
    {selected&&<ReservationModal listing={selected} quantity={reserveQty} setQuantity={setReserveQty} onClose={()=>setSelected(null)} onReserve={reserve}/>} 
    {confirmation&&<Confirmation data={confirmation} onClose={()=>setConfirmation(null)}/>} 
    {donationOpen&&<DonationModal text={intakeText} setText={setIntakeText} listening={listening} busy={agentBusy} onVoice={startVoice} drafts={drafts} onAnalyze={makeDrafts} onPublish={publishDrafts} onClose={closeDonation}/>}
    {toast&&<div className="toast" role="status">✓ {toast}</div>}
  </main>;
}

function Browse({listings,visibleListings,servings,filter,setFilter,openPlanner,select,openDonation}:{listings:Listing[];visibleListings:Listing[];servings:number;filter:'all'|'meal'|'ingredient';setFilter:(f:'all'|'meal'|'ingredient')=>void;openPlanner:()=>void;select:(l:Listing)=>void;openDonation:()=>void}){
  return <><section className="hero"><div className="hero-copy"><p className="eyebrow">Charlotte · Tonight</p><h1>Good food,<br/><em>still in time.</em></h1><p className="hero-description">Reserve surplus meals and ingredients from kitchens near you—free, local, and ready for pickup.</p></div><div className="impact-stamp"><span>Tonight</span><strong>{servings}</strong><small>meals available</small></div></section><section className="content"><div className="section-heading"><div><p className="eyebrow">Near Plaza Midwood</p><h2>Available near you</h2></div><button className="location-button">Within 3 miles <span>⌄</span></button></div><div className="filters"><button className={`filter ${filter==='all'?'active':''}`} onClick={()=>setFilter('all')}>All food <span>{listings.length}</span></button><button className={`filter ${filter==='meal'?'active':''}`} onClick={()=>setFilter('meal')}>Ready to eat <span>{listings.filter(x=>x.category==='meal').length}</span></button><button className={`filter ${filter==='ingredient'?'active':''}`} onClick={()=>setFilter('ingredient')}>Ingredients <span>{listings.filter(x=>x.category==='ingredient').length}</span></button><button className="filter" onClick={openPlanner}>✦ What can I cook?</button></div><div className="listing-grid">{visibleListings.length?visibleListings.map(listing=><FoodCard key={listing.id} listing={listing} onSelect={()=>select(listing)}/>):<div className="empty-state"><strong>No food is available yet.</strong><p>Kitchen listings will appear here as they are published.</p></div>}</div></section><aside className="donor-cta"><div><p className="eyebrow">For local kitchens</p><h2>Have food left tonight?</h2><p>Say what’s left. We’ll turn it into a post you can review.</p></div><button onClick={openDonation}>＋ Post a donation</button></aside></>;
}

function FoodCard({listing,onSelect}:{listing:Listing;onSelect:()=>void}){return <article className="food-card"><div className={`food-art ${listing.tone}`}><span className="distance">{listing.distance} mi</span><span className="art-mark">{listing.category==='ingredient'?'✦':'●'}</span></div><div className="card-body"><div className="card-meta"><span>{listing.readiness}</span><span>Available</span></div><p className="donor">{listing.donor}</p><h3>{listing.title}</h3><p className="detail">{listing.detail}</p><div className="availability"><strong>{listing.quantity} {listing.unit} left</strong><span>Pickup {listing.time}</span></div><button className="reserve-button" onClick={onSelect}>View &amp; reserve <span>→</span></button></div></article>}

function ReservationModal({listing,quantity,setQuantity,onClose,onReserve}:{listing:Listing;quantity:number;setQuantity:(n:number)=>void;onClose:()=>void;onReserve:()=>void}){const max=listing.unit==='meals'?Math.min(4,listing.quantity):Math.min(10,listing.quantity);return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal-card reserve-modal" role="dialog" aria-modal="true" onMouseDown={e=>e.stopPropagation()}><button className="close-button" onClick={onClose}>×</button><p className="eyebrow">{listing.donor} · {listing.distance} mi away</p><h2>{listing.title}</h2><p className="modal-lede">{listing.detail}</p><div className="notice-row"><span>◷</span><div><strong>Pickup window</strong><small>{listing.time} · Exact address after reserving</small></div></div><div className="notice-row"><span>i</span><div><strong>Allergen information</strong><small>{listing.allergens}</small></div></div><div className="quantity-row"><div><strong>How much?</strong><small>Maximum {max} {listing.unit}</small></div><div className="stepper"><button onClick={()=>setQuantity(Math.max(1,quantity-1))}>−</button><strong>{quantity}</strong><button onClick={()=>setQuantity(Math.min(max,quantity+1))}>＋</button></div></div><button className="primary-action" onClick={onReserve}>Reserve for pickup</button><p className="fine-print">Please cancel if your plans change so someone else can collect it.</p></section></div>}

function Confirmation({data,onClose}:{data:{title:string;quantity:number;code:string;address?:string;pickup?:string};onClose:()=>void}){return <div className="modal-backdrop"><section className="modal-card confirmation" role="dialog" aria-modal="true"><div className="success-mark">✓</div><p className="eyebrow">Reservation confirmed</p><h2>It’s yours.</h2><p>{data.quantity} × {data.title}</p><div className="pickup-code"><small>Show this code at pickup</small><strong>{data.code}</strong></div><div className="pickup-address"><strong>Pickup details</strong><span>{data.address||'Pickup address unavailable'}</span><span>{data.pickup||'Pickup time unavailable'}</span></div><button className="primary-action" onClick={onClose}>Done</button></section></div>}

function DonationModal({text,setText,listening,busy,onVoice,drafts,onAnalyze,onPublish,onClose}:{text:string;setText:(v:string)=>void;listening:boolean;busy:boolean;onVoice:()=>void;drafts:Listing[];onAnalyze:()=>void|Promise<void>;onPublish:()=>void|Promise<void>;onClose:()=>void}){return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal-card donation-modal" role="dialog" aria-modal="true" onMouseDown={e=>e.stopPropagation()}><button className="close-button" onClick={onClose}>×</button><p className="eyebrow">Fast donation entry</p><h2>Tell us what’s left.</h2><p className="modal-lede">Speak naturally—include quantities and a pickup window. You’ll review everything before it goes live.</p>{drafts.length===0?<><div className={`voice-box ${listening?'listening':''}`}><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Example: We have 12 chicken and rice boxes, plus 8 pounds of carrots…"/><button className="mic-button" onClick={onVoice}>{listening?'Listening…':'◉ Speak instead'}</button></div><button className="primary-action" disabled={busy} onClick={onAnalyze}>{busy?'Creating draft…':'Create donation draft ✦'}</button></>:<><div className="review-heading"><strong>Review {drafts.length} suggested posts</strong><span>Nothing publishes until you confirm.</span></div><div className="draft-list">{drafts.map(draft=><div className="draft-card" key={draft.id}><span className={`draft-icon ${draft.tone}`}>{draft.category==='meal'?'●':'✦'}</span><div><strong>{draft.title}</strong><p>{draft.detail}</p><small>{draft.quantity} {draft.unit} · Pickup {draft.time}</small><em>{draft.allergens}</em></div><button>Edit</button></div>)}</div><button className="primary-action" disabled={busy} onClick={onPublish}>{busy?'Publishing…':`Publish ${drafts.length} donation${drafts.length===1?'':'s'}`}</button></>}</section></div>}

function DonorDashboard({listings,organizationId,onPost,onSwitch,showSwitch,notify}:{listings:Listing[];organizationId?:string;onPost:()=>void;onSwitch:()=>void;showSwitch:boolean;notify:(m:string)=>void}){const own=listings.filter(item=>organizationId?item.organizationId===organizationId:item.donor==='Your kitchen');return <div className="dashboard"><section className="dashboard-hero"><div><p className="eyebrow">Your kitchen · Live</p><h1>Save the surplus.<br/><em>Skip the typing.</em></h1><p className="hero-description">Speak what’s left at the end of service. We’ll organize the items, quantities, and pickup window for your review.</p><button className="voice-primary" onClick={onPost}><span>◉</span> Start a quick donation</button></div><div className="shift-card"><span>Currently available</span><strong>{own.length}</strong><small>live {own.length===1?'listing':'listings'}</small><div>Completed pickups not tracked yet</div></div></section><section className="dashboard-content"><div className="dashboard-title"><div><p className="eyebrow">Live pickups</p><h2>Your donations</h2></div>{showSwitch&&<button className="secondary-button" onClick={onSwitch}>See recipient view</button>}</div><div className="pickup-table"><div className="table-head"><span>Donation</span><span>Available</span><span>Pickup window</span><span>Status</span><span></span></div>{own.length?own.map(item=><div className="table-row" key={item.id}><span><i className={`mini-art ${item.tone}`}>{item.category==='meal'?'●':'✦'}</i><b>{item.title}</b><small>{item.detail}</small></span><span>{item.quantity} {item.unit}</span><span>{item.time}</span><span><mark>Accepting reservations</mark></span><button onClick={()=>notify('Pickup list opened.')}>Manage →</button></div>):<div className="empty-table"><strong>No donations published yet.</strong><span>Use “Start a quick donation” to create your first live listing.</span></div>}</div></section></div>}

function Planner({listingCount,maxStops,setMaxStops,maxMiles,setMaxMiles,onBack}:{listingCount:number;maxStops:number;setMaxStops:(n:number)=>void;maxMiles:number;setMaxMiles:(n:number)=>void;onBack:()=>void}){return <div className="planner"><section className="planner-hero"><button className="back-link" onClick={onBack}>← Back to food</button><p className="eyebrow">Smart ingredient rescue</p><h1>What could we<br/><em>cook tonight?</em></h1><p className="hero-description">We combine expiring ingredients from nearby kitchens, then keep the pickup route practical.</p></section><section className="planner-controls"><div><label>Maximum stops <strong>{maxStops}</strong></label><input type="range" min="1" max="3" value={maxStops} onChange={e=>setMaxStops(Number(e.target.value))}/><span><small>1 stop</small><small>3 stops</small></span></div><div><label>Maximum route <strong>{maxMiles} miles</strong></label><input type="range" min="1" max="5" value={maxMiles} onChange={e=>setMaxMiles(Number(e.target.value))}/><span><small>Nearby</small><small>5 miles</small></span></div><div className="planner-note">✦ Suggestions will use only live ingredient listings within these limits.</div></section><section className="plans"><div className="section-heading"><div><p className="eyebrow">Meal planner</p><h2>{listingCount?`${listingCount} live ingredient listing${listingCount===1?'':'s'} available`:'Waiting for live ingredients'}</h2></div></div><div className="empty-plan"><strong>{listingCount?'AI meal plans are not generated until requested.':'No ingredients are available yet.'}</strong><p>{listingCount?'Plan generation will use the live inventory above—no sample recipes or routes.':'Publish ingredient listings from kitchen accounts to begin testing meal planning.'}</p></div></section></div>}

function Impact({servings,onBack}:{servings:number;onBack:()=>void}){return <div className="impact-page"><button className="back-link" onClick={onBack}>← Back to food</button><section><p className="eyebrow">Charlotte network · Live data</p><h1>Small pickups.<br/><em>Real impact.</em></h1><div className="impact-grid"><div><strong>—</strong><span>servings collected · not tracked yet</span></div><div><strong>—</strong><span>ingredients rescued · not tracked yet</span></div><div><strong>—</strong><span>pickup completion · not tracked yet</span></div><div><strong>{servings}</strong><span>ready-to-eat meals available now</span></div></div></section></div>}
