import {adminPath} from './app-paths';
import {bookingCalendar} from './calendar';
import {provideNativeDateAdapter} from '@spartan-ng/brain/date-time';
import {HlmDialog} from './ui/dialog';
import {provideSpartanHlm} from '@spartan-ng/helm/utils';
import {UI_IMPORTS,UI_ICON_PROVIDERS} from './ui';
import {AdminPortal} from './admin';
import {Component,signal,ViewChild,ChangeDetectorRef,inject,ElementRef} from '@angular/core';
import {bootstrapApplication} from '@angular/platform-browser';
import {FormsModule} from '@angular/forms';
import {configured,supabase,rpc,watch,slotModel,readAll} from './backend';
interface Campaign {id:string;name:string;description:string}
interface Slot {id:string;campaignId:string;startTime:any;endTime:any;capacity:number;bookedCount:number;names:string[];status:string}
@Component({selector:'app-root',standalone:true,host:{'(document:click)':'closePeek($event)'},imports:[UI_IMPORTS,FormsModule],templateUrl:'./booking-page.html'})
class App {
 private changeDetector=inject(ChangeDetectorRef);
 @ViewChild('bookingDialog') bookingDialog?:HlmDialog;
 @ViewChild('availabilityHeading') availabilityHeading?:ElementRef<HTMLElement>;
 private choosingAnotherTime=false;

 adminPath=adminPath;
 configured=configured; campaigns=signal<Campaign[]>([]);slots=signal<Slot[]>([]);sbus=signal<string[]>(['Technology','CXO','Other']);error=signal('');selected?:Campaign;slot?:Slot;name='';code='';sbu='';busy=false;reference='';requestId=crypto.randomUUID();step=1;selectedDay='';availableOnly=false;clock=signal(Date.now());expiryTimer?:ReturnType<typeof setInterval>;slotStops:(()=>void)[]=[];refreshTimer?:ReturnType<typeof setTimeout>;focusRefresh=()=>{this.clock.set(Date.now());void this.load();};loading=signal(true);stops:(()=>void)[]=[];
 constructor(){try{localStorage.removeItem('pause.details');}catch{}if(!this.configured){this.loading.set(false);return;}void this.load();this.expiryTimer=setInterval(()=>{this.clock.set(Date.now());if(this.selectedDay&&!this.days().includes(this.selectedDay))this.selectedDay=this.days()[0]||'';},1000);window.addEventListener('focus',this.focusRefresh);this.stops.push(watch('campaigns',()=>this.queueRefresh()),watch('sbus',()=>this.queueRefresh()));}
 queueRefresh(){clearTimeout(this.refreshTimer);this.refreshTimer=setTimeout(()=>void this.load(),200);}
 slotRefreshTimers=new Map<string,ReturnType<typeof setTimeout>>();
 queueSlotRefresh(id:string){clearTimeout(this.slotRefreshTimers.get(id));this.slotRefreshTimers.set(id,setTimeout(async()=>{this.slotRefreshTimers.delete(id);try{const rows=await readAll((a,b)=>supabase.from('slots').select('*').eq('campaign_id',id).gt('start_time',new Date().toISOString()).order('start_time').order('id').range(a,b));const before=this.counts();this.slots.update(current=>[...current.filter(s=>s.campaignId!==id),...rows.map(slotModel)].sort((a,b)=>this.newDate(a.startTime)-this.newDate(b.startTime)));this.flagFresh(before);if(this.slot){const latest=this.slots().find(s=>s.id===this.slot!.id);if(latest)this.slot=latest;}}catch{this.error.set('Unable to refresh availability. Please try again.');}},200));}
 loadSequence=0;
 async load(){const sequence=++this.loadSequence;try{const c=await readAll((a,b)=>supabase.from('campaigns').select('*').eq('status','published').order('id').range(a,b));const ids=c.map(x=>x.id);const [slots,u]=await Promise.all([ids.length?readAll((a,b)=>supabase.from('slots').select('*').in('campaign_id',ids).gt('start_time',new Date().toISOString()).order('start_time').order('id').range(a,b)):Promise.resolve([]),readAll((a,b)=>supabase.from('sbus').select('name').order('name').range(a,b))]);if(sequence!==this.loadSequence)return;this.campaigns.set(c.filter(x=>slots.some(s=>s.campaign_id===x.id)));const before=this.counts();this.slots.set(slots.map(slotModel));this.flagFresh(before);this.sbus.set(u.map(x=>x.name));this.slotStops.forEach(stop=>stop());this.slotStops=ids.map(id=>watch('slots',()=>this.queueSlotRefresh(id),'campaign_id=eq.'+id));if(this.selected&&!this.campaigns().some(c=>c.id===this.selected!.id)&&this.bookingDialog?.stateComputed()!=='open')this.choose(null);if(!this.selected&&this.visibleCampaigns().length)this.choose(this.visibleCampaigns()[0]);if(this.slot){const latest=this.slots().find(s=>s.id===this.slot!.id);if(latest)this.slot=latest;}}catch{this.error.set('Unable to load availability. Please try again.');}finally{if(sequence===this.loadSequence)this.loading.set(false);}}
 campaignOptionLabel=(id:string)=>this.visibleCampaigns().find(c=>c.id===id)?.name||'';
 chooseCampaignId(id:string){if(this.selected?.id===id)return;this.choose(this.visibleCampaigns().find(c=>c.id===id)||null);}
 choose(c:Campaign|null){this.selected=c||undefined;this.reference='';this.slot=undefined;this.peek='';const days=this.days();this.selectedDay=days.find(day=>this.dayPlaces(day)>0)||days[0]||'';this.availableOnly=false;}
 retryLoad(){this.error.set('');this.loading.set(true);void this.load();}
 openBooking(){if(!this.slot||!this.available(this.slot))return;this.step=this.reference?3:2;this.error.set('');this.bookingDialog?.open();}
 closeBooking(){if(this.busy)return;this.bookingDialog?.close();}
 resetBooking(){
  this.calendarEvent=null;this.step=1;this.slot=undefined;this.error.set('');
  if(this.choosingAnotherTime){
   this.choosingAnotherTime=false;
   this.availabilityHeading?.nativeElement.focus();
  }
  this.changeDetector.markForCheck();
 }
 timeFilled(){
  return this.step===2&&(
   this.error()==='This time slot has just been fully booked.'||
   !!this.slot&&this.slot.status==='active'&&this.slot.bookedCount>=this.slot.capacity
  );
 }
 /** Free times in this campaign closest to the one that was just taken, same day first. */
 alternatives(){
  const taken=this.slot;if(!taken)return [];
  const at=this.newDate(taken.startTime),day=this.dayKey(taken.startTime);
  const distance=(s:Slot)=>(this.dayKey(s.startTime)===day?0:1e13)+Math.abs(this.newDate(s.startTime)-at);
  return this.slots().filter(s=>s.campaignId===taken.campaignId&&s.id!==taken.id&&this.available(s)).sort((a,b)=>distance(a)-distance(b)).slice(0,4).sort((a,b)=>this.newDate(a.startTime)-this.newDate(b.startTime));
 }
 sameDay(a:Slot,b:Slot){return this.dayKey(a.startTime)===this.dayKey(b.startTime);}
 switchTo(s:Slot){if(this.busy||!this.available(s))return;this.error.set('');this.selectedDay=this.dayKey(s.startTime);this.pick(s);}
 /** Business units A to Z, with "Other" kept last so it reads as the fallback. */
 sortedSbus(){const other=(name:string)=>name.trim().toLowerCase()==='other';return [...this.sbus()].sort((a,b)=>Number(other(a))-Number(other(b))||a.localeCompare(b,undefined,{sensitivity:'base'}));}
 unitQuery='';
 /** Search results for long lists: names starting with the typed letters first, then names containing them. */
 unitMatches(){
  const q=this.unitQuery.trim().toLowerCase();if(!q)return [];
  const all=this.sortedSbus().filter(name=>name.toLowerCase().includes(q));
  return [...all.filter(name=>name.toLowerCase().startsWith(q)),...all.filter(name=>!name.toLowerCase().startsWith(q))];
 }
 unitOptions(){return this.unitQuery.trim()?this.unitMatches():this.sortedSbus();}
 otherUnit(){return this.sbus().find(name=>name.trim().toLowerCase()==='other');}
 chooseUnit(name:string){this.sbu=name;this.unitQuery='';}
 hour(t:string){return new Date(new Date(t).getTime()+4*3600000).getUTCHours();}
 /** Times of the chosen day by part of day, with bookable times separated from the ones already taken. */
 dayGroups(){
  const parts=[{label:'Morning',from:0,to:12},{label:'Afternoon',from:12,to:17},{label:'Evening',from:17,to:24}];
  return parts.map(part=>{const all=this.daySlots().filter(s=>{const h=this.hour(s.startTime);return h>=part.from&&h<part.to;});return {label:part.label,open:all.filter(s=>this.available(s)),taken:this.availableOnly?[]:all.filter(s=>!this.available(s))};}).filter(group=>group.open.length||group.taken.length);
 }
 /** How booked a day is, 0 to 100: the bar on each day tile fills up as places are taken. */
 dayFill(day:string){const all=this.slots().filter(s=>s.campaignId===this.selected?.id&&this.future(s)&&s.status==='active'&&this.dayKey(s.startTime)===day);const capacity=all.reduce((sum,s)=>sum+s.capacity,0);const taken=all.reduce((sum,s)=>sum+Math.min(s.bookedCount,s.capacity),0);return capacity?Math.round(taken/capacity*100):100;}
 // Live updates: remember which times just changed so the page can show it happening.
 fresh=signal<Record<string,true>>({});
 counts(){return new Map(this.slots().map(s=>[s.id,s.bookedCount] as [string,number]));}
 flagFresh(before:Map<string,number>){
  if(!before.size)return;
  const changed=this.slots().filter(s=>before.has(s.id)&&before.get(s.id)!==s.bookedCount).map(s=>s.id);
  if(!changed.length)return;
  this.fresh.update(current=>({...current,...Object.fromEntries(changed.map(id=>[id,true as const]))}));
  setTimeout(()=>this.fresh.update(current=>{const next={...current};changed.forEach(id=>delete next[id]);return next;}),2800);
 }
 chooseAnotherTime(){
  if(this.busy)return;
  const alternatives=this.slots().filter(slot=>slot.campaignId===this.selected?.id&&slot.id!==this.slot?.id&&this.available(slot));
  const next=alternatives.find(slot=>this.dayKey(slot.startTime)===this.selectedDay)||alternatives[0];
  if(next)this.selectedDay=this.dayKey(next.startTime);
  this.availableOnly=true;
  this.choosingAnotherTime=true;
  this.closeBooking();
 }
 ngOnDestroy(){this.slotRefreshTimers.forEach(timer=>clearTimeout(timer));clearInterval(this.expiryTimer);clearTimeout(this.refreshTimer);window.removeEventListener('focus',this.focusRefresh);this.slotStops.forEach(stop=>stop());this.stops.forEach(stop=>stop());}
 campaignRange(id:string){const days=[...new Set(this.slots().filter(s=>s.campaignId===id&&this.future(s)).map(s=>this.dayKey(s.startTime)))].sort();if(!days.length)return 'No upcoming dates';const label=(d:string)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Indian/Mauritius',day:'numeric',month:'short',year:'numeric'}).format(new Date(d+'T12:00:00+04:00'));return days.length===1?label(days[0]):label(days[0])+' – '+label(days[days.length-1]);}

 visibleCampaigns(){const next=(id:string)=>Math.min(...this.slots().filter(s=>s.campaignId===id&&this.future(s)).map(s=>this.newDate(s.startTime)));return this.campaigns().filter(c=>this.slots().some(s=>s.campaignId===c.id&&this.future(s))).sort((a,b)=>next(a.id)-next(b.id));}
 newDate(t:string){return new Date(t).getTime();}
 dayKey(t:string){return new Date(new Date(t).getTime()+4*3600000).toISOString().slice(0,10);}
 days(){return [...new Set(this.slots().filter(s=>s.campaignId===this.selected?.id&&this.future(s)).map(s=>this.dayKey(s.startTime)))].sort();}
 dayLabel(day:string){return new Intl.DateTimeFormat('en-GB',{timeZone:'Indian/Mauritius',weekday:'short',day:'numeric',month:'short'}).format(new Date(day+'T12:00:00+04:00'));}
 daySlots(){return this.slots().filter(s=>s.campaignId===this.selected?.id&&this.future(s)&&this.dayKey(s.startTime)===this.selectedDay);}
 shownSlots(){return this.daySlots().filter(s=>!this.availableOnly||this.available(s));}
 allTimesBooked(){
  const slots=this.daySlots();
  return slots.length>0&&slots.every(slot=>slot.status==='active'&&slot.bookedCount>=slot.capacity);
 }
 dayPlaces(day:string){return this.slots().filter(s=>s.campaignId===this.selected?.id&&this.dayKey(s.startTime)===day&&this.available(s)).reduce((total,s)=>total+s.capacity-s.bookedCount,0);}
 durationLabel(){const durations=[...new Set(this.daySlots().map(s=>(this.newDate(s.endTime)-this.newDate(s.startTime))/60000))];return durations.length===1?durations[0]+'-minute sessions':'Duration shown when you select a time';}
 available(s:Slot){return this.future(s)&&s.status==='active'&&s.bookedCount<s.capacity;}
 places(id:string){return this.slots().filter(s=>s.campaignId===id&&this.available(s)).reduce((sum,s)=>sum+s.capacity-s.bookedCount,0);}
 dayPart(day:string,part:'weekday'|'day'|'month'){return new Intl.DateTimeFormat('en-GB',{timeZone:'Indian/Mauritius',[part]:part==='day'?'numeric':'short'}).format(new Date(day+'T12:00:00+04:00'));}
 longDay(day:string){return new Intl.DateTimeFormat('en-GB',{timeZone:'Indian/Mauritius',weekday:'long',day:'numeric',month:'long'}).format(new Date(day+'T12:00:00+04:00'));}
 placesLeft(s:Slot){return Math.max(0,s.capacity-s.bookedCount);}
 seats(s:Slot){return s.capacity<=8?Array.from({length:s.capacity},(_,i)=>i<s.bookedCount):[];}
 slotState(s:Slot):'open'|'full'|'closed'{return this.available(s)?'open':s.status==='active'&&s.bookedCount>=s.capacity?'full':'closed';}
 availabilityLabel(s:Slot){const state=this.slotState(s);if(state==='closed')return 'Unavailable';if(state==='full')return 'Fully booked';const left=this.placesLeft(s);return left+(left===1?' place left':' places left');}
 placesLabel(count:number){return count===0?'No places left':count+(count===1?' place left':' places left');}
 selectDay(day:string){this.selectedDay=day;this.slot=undefined;this.peek='';}
 book(s:Slot){if(!this.available(s))return;this.selectedDay=this.dayKey(s.startTime);this.pick(s);this.openBooking();}
 peek='';
 tap(s:Slot,event?:Event){if(this.available(s)){this.peek='';this.book(s);}else this.show(s.id,event);}
 /** Open the attendee card for a time, keeping it inside the screen edges. */
 peekSide:'start'|'center'|'end'='center';
 show(id:string,event?:Event){
  const cell=(event?.currentTarget as HTMLElement|null)?.closest?.('.pz-cell');
  if(cell){const box=cell.getBoundingClientRect(),middle=box.left+box.width/2;this.peekSide=middle-100<12?'start':middle+100>window.innerWidth-12?'end':'center';}
  this.peek=id;
 }
 closePeek(event:Event){if(!(event.target as HTMLElement|null)?.closest?.('.pz-slot,.pz-mini'))this.peek='';}
 initials(name:string){return name.trim().split(/\s+/).slice(0,2).map(part=>part.charAt(0).toUpperCase()).join('');}
 /** One entry per place when the session is small: initials for a taken place, '' for a free one. */
 faces(s:Slot){return s.capacity<=4?Array.from({length:s.capacity},(_,i)=>i<s.bookedCount?(this.initials(s.names[i]||'')||'·'):''):[];}
 withNames(names:string[]){return names.length<2?names.join(''):names.slice(0,-1).join(', ')+' and '+names[names.length-1];}
 pick(s:Slot){this.reference='';this.slot=s;this.requestId=crypto.randomUUID();}
 future(s:Slot){return new Date(s.startTime).getTime()>this.clock();}
 appointmentDate(t:string){return new Intl.DateTimeFormat('en-GB',{timeZone:'Indian/Mauritius',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(t));}
 format(t:any){return new Intl.DateTimeFormat('en-GB',{timeZone:'Indian/Mauritius',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(t));}
 time(t:any){return new Intl.DateTimeFormat('en-GB',{timeZone:'Indian/Mauritius',hour:'2-digit',minute:'2-digit'}).format(new Date(t));}
 duplicateBooking(){return /already have a booking for this campaign/i.test(this.error());}
 /** Employee codes are digits only: anything else is dropped as it is typed or pasted. */
 setCode(value:string,input:HTMLInputElement,model:{control:{value:unknown;setValue:(value:string,options?:object)=>void}}){const digits=String(value??'').replace(/\D/g,'');this.code=digits;if(input.value!==digits)input.value=digits;if(model.control.value!==digits)model.control.setValue(digits,{emitEvent:false,emitModelToViewChange:false,emitViewToModelChange:false});this.clearCodeWarning();}
 clearCodeWarning(){if(this.duplicateBooking())this.error.set('');}
 calendarEvent:{reference:string;campaign:string;start:string;end:string}|null=null;
 downloadCalendar(){if(!this.calendarEvent||this.step!==3)return;const url=URL.createObjectURL(new Blob([bookingCalendar(this.calendarEvent)],{type:'text/calendar;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='pause-booking-'+this.calendarEvent.reference.replace(/[^a-zA-Z0-9-]/g,'')+'.ics';(document.querySelector('[role="dialog"]')||document.body).appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async confirm(){if(this.busy||!this.slot||this.duplicateBooking()||this.timeFilled())return;this.busy=true;this.error.set('');try{this.reference=await rpc('create_booking',{p_campaign_id:this.selected!.id,p_slot_id:this.slot.id,p_employee_name:this.name,p_employee_code:this.code,p_sbu:this.sbu,p_request_id:this.requestId});this.calendarEvent={reference:this.reference,campaign:this.selected!.name,start:this.slot.startTime,end:this.slot.endTime};this.step=3;}catch(e:any){this.error.set(e.message||'Unable to confirm. Retry with the same details to recover your booking.');if(this.timeFilled())this.queueSlotRefresh(this.slot.campaignId);}finally{this.busy=false;this.changeDetector.markForCheck();}}
}
if((location.pathname===adminPath||location.pathname===adminPath+'/'||location.pathname===adminPath+'/login'||location.pathname===adminPath+'/login/')) {
 document.querySelector('app-root')!.outerHTML='<admin-portal></admin-portal>';
 document.body.classList.add('pa');
 bootstrapApplication(AdminPortal,{providers:[provideNativeDateAdapter(),provideSpartanHlm(),UI_ICON_PROVIDERS]}).catch(console.error);
} else bootstrapApplication(App,{providers:[provideNativeDateAdapter(),provideSpartanHlm(),UI_ICON_PROVIDERS]}).catch(console.error);
