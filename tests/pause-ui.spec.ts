import {readFile} from 'node:fs/promises';
import {test,expect,Page} from '@playwright/test';

const futureDay=(offset:number)=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
const day=futureDay(30),nextDay=futureDay(31);
const campaignId='11111111-1111-4111-8111-111111111111';
const secondId='22222222-2222-4222-8222-222222222222';

async function fixture(page:Page,admin=false,singleCampaign=false,manyDates=false){
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&message.text().startsWith('ERROR'))errors.push(message.text());});
 await page.routeWebSocket(/supabase\.co/,socket=>socket.close());
 if(admin)await page.addInitScript(()=>{
  const claims={sub:'33333333-3333-4333-8333-333333333333',email:'admin@example.test',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600};
  const token=btoa(JSON.stringify({alg:'HS256',typ:'JWT'}))+'.'+btoa(JSON.stringify(claims))+'.fixture';
  localStorage.setItem('sb-nkwduolajrhpqnkexlsq-auth-token',JSON.stringify({access_token:token,refresh_token:'fixture',expires_at:claims.exp,expires_in:3600,token_type:'bearer',user:{id:claims.sub,email:claims.email,aud:'authenticated',role:'authenticated'}}));
 });
 const campaigns=[{id:campaignId,name:'Workplace wellness',description:'Take a break.',status:'published',created_at:'2026-01-01T00:00:00Z'},{id:secondId,name:'Second campaign',description:'More sessions.',status:'published',created_at:'2026-01-02T00:00:00Z'}];
 if(singleCampaign)campaigns.splice(1);
 const slot=(id:string,campaign_id:string,session_id:string,date:string,hour:number,booked_count=0)=>({id,campaign_id,session_id,start_time:`${date}T${String(hour).padStart(2,'0')}:00:00Z`,end_time:`${date}T${String(hour).padStart(2,'0')}:30:00Z`,capacity:3,booked_count,names:booked_count?['Jane','Sam','Alex'].slice(0,booked_count):[],status:'active'});
 const slots=[slot('s1',campaignId,'date1',day,5,1),slot('s2',campaignId,'date1',day,6,3),slot('s3',campaignId,'date2',nextDay,5),slot('s4',secondId,'date3',day,7)];
 if(manyDates)for(let i=2;i<14;i++)slots.push(slot('extra'+i,campaignId,'extra-date'+i,futureDay(30+i),5));
 let admins=[{email:'admin@example.test',full_name:'Jane Admin',enabled:true,updated_at:'2026-01-01T00:00:00Z'},{email:'other@example.test',full_name:'Other Admin',enabled:true,updated_at:'2026-01-01T00:00:00Z'}];
 let cancellation:any={};
 let units=['Technology','CXO','Other'];let booking={id:'b1',campaign_id:campaignId,slot_id:'s1',employee_name:'Jane',employee_code:'27',sbu:'Technology',status:'confirmed',updated_at:'2026-01-01T00:00:00Z'};
 const writes:{name:string;body:any}[]=[];
 await page.route('**/auth/v1/**',route=>route.fulfill({json:{}}));
 await page.route('**/rest/v1/**',async route=>{
  const url=new URL(route.request().url());const name=url.pathname.split('/').pop()!;
  const body=route.request().method()==='POST'?route.request().postDataJSON():{};
  if(['save_campaign_v2','create_booking','update_booking','save_sbus','delete_campaign','set_campaign_status','save_administrator','set_administrator_status','cancel_booking'].includes(name))writes.push({name,body});
  if(name==='create_booking'&&body.p_employee_code==='999')return route.fulfill({status:400,json:{code:'P0001',message:'You already have a booking for this campaign.'}});
  if(name==='create_booking'){
   const target=slots.find(slot=>slot.id===body.p_slot_id);
   if(target&&target.booked_count>=target.capacity)return route.fulfill({status:400,json:{code:'P0001',message:'This time slot has just been fully booked.'}});
  }
  if(name==='set_campaign_status')campaigns.find(c=>c.id===body.p_campaign_id)!.status=body.p_status;
  if(name==='save_sbus')units=body.p_names.split(',').map((s:string)=>s.trim());
  if(name==='cancel_booking'){cancellation={status:'cancelled',cancelled_by_name:'Jane Admin',cancelled_at:new Date().toISOString()};slots[0].booked_count=0;slots[0].names=[];}
  if(name==='update_booking')booking={...booking,employee_name:body.p_name,employee_code:body.p_code,sbu:body.p_sbu,slot_id:body.p_slot_id};
  let data:any=[];
  if(name==='campaigns')data=url.searchParams.get('select')==='id,name,status'?[...campaigns].sort((a,b)=>b.created_at.localeCompare(a.created_at)):campaigns;
  if(name==='slots'){const filter=url.searchParams.get('campaign_id');data=filter?.startsWith('eq.')?slots.filter(s=>s.campaign_id===filter.slice(3)):slots;}
  if(name==='sessions')data=[{id:'date1',campaign_id:campaignId},{id:'date2',campaign_id:campaignId},{id:'date3',campaign_id:secondId}];
  if(name==='sbus')data=units.map(name=>({name}));
  if(name==='admin_directory')data={rows:admins.filter(a=>[a.email,a.full_name].join(' ').toLowerCase().includes((body.p_search||'').toLowerCase())),total:admins.length};
  if(name==='save_administrator'){const existing=admins.find(a=>a.email===body.p_email);if(existing)existing.full_name=body.p_full_name;else admins.push({email:body.p_email,full_name:body.p_full_name,enabled:true,updated_at:'2026-01-02T00:00:00Z'});data=true;}
  if(name==='set_administrator_status'){admins.find(a=>a.email===body.p_email)!.enabled=body.p_enabled;data=true;}
  if(name==='is_admin')data=true;
  if(name==='current_admin_profile')data=[{full_name:'Jane Admin',email:'admin@example.test'}];
  if(name==='campaign_save_info_page')data=[{campaign_id:campaignId,saved_at:'2026-01-01T12:00:00Z',saved_by:'Test Administrator'}];
  if(name==='booking_page'||name==='booking_page_filtered'){const row={...booking,...cancellation};const rows=!body.p_status||row.status===body.p_status?[row]:[];data={total:rows.length,rows};}
  if(name==='create_booking')data='booking-reference';
  if(['update_booking','save_sbus','save_campaign_v2','delete_campaign','set_campaign_status','save_administrator','set_administrator_status','cancel_booking'].includes(name))data=true;
  await route.fulfill({json:data,headers:{'access-control-expose-headers':'content-range','access-control-allow-origin':'*','content-range':`0-${Array.isArray(data)?Math.max(0,data.length-1):0}/${name==='campaigns'?campaigns.length:1}`}});
 });
 return {errors,writes,slots};
}

async function chooseOption(page:Page,selector:string,text:string){await page.locator(selector).click();await page.getByRole('option',{name:text,exact:true}).click();await expect(page.getByRole('listbox')).toHaveCount(0);}
const noOverflow=(page:Page)=>page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
const openSlot=(page:Page,time='09:00 to 09:30')=>page.getByRole('button',{name:new RegExp('^Book '+time)});
async function openBooking(page:Page){await openSlot(page).click();const dialog=page.getByRole('dialog');await expect(dialog.getByRole('heading',{name:/09:00/})).toBeVisible();return dialog;}
async function fillDetails(page:Page,name:string,code:string,unit='Technology'){const dialog=page.getByRole('dialog');await dialog.getByLabel('Full name',{exact:true}).fill(name);await dialog.getByLabel('Employee code',{exact:true}).fill(code);await dialog.getByText(unit,{exact:true}).click();}
const adminRow=(page:Page,name:string)=>page.getByRole('row').filter({hasText:name});

// ---------------------------------------------------------------- Employee booking page

test('booking page shows the brand, the campaigns and no leftover massage wording',async({page})=>{
 const {errors}=await fixture(page);await page.goto('/');
 await expect(page.getByRole('heading',{name:'Press pause.',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Pause home'})).toContainText('Employee wellness');
 const admin=page.getByRole('link',{name:/Admin panel/}).first();await expect(admin).toHaveAttribute('target','_blank');await expect(admin).toHaveAttribute('href',/bk-admin-codex$/);
 await expect(page.locator('[data-campaign-choice]')).toHaveCount(2);
 await expect(page.locator('[data-campaign-choice]').filter({hasText:'Workplace wellness'})).toHaveAttribute('aria-selected','true');
 expect((await page.locator('body').innerText()).toLowerCase()).not.toContain('massage');
 expect(errors).toEqual([]);
});

test('a single campaign needs no campaign choice',async({page})=>{
 const {errors}=await fixture(page,false,true);await page.goto('/');
 await expect(page.getByRole('heading',{name:'Workplace wellness',exact:true})).toBeVisible();
 await expect(page.locator('[data-campaign-choice]')).toHaveCount(0);
 await expect(openSlot(page)).toBeVisible();expect(errors).toEqual([]);
});

test('days, parts of the day and full times read at a glance',async({page})=>{
 const {errors}=await fixture(page);await page.goto('/');
 const days=page.locator('[data-date-choice]');await expect(days).toHaveCount(2);await expect(days.first()).toHaveAttribute('aria-selected','true');
 await expect(page.getByRole('heading',{name:'Morning',exact:true})).toBeVisible();
 await expect(openSlot(page)).toHaveAccessibleName(/2 places left\. Attending: Jane/);
 const full=page.locator('.pz-mini');await expect(full).toHaveCount(1);await expect(full).toContainText('10:00');await expect(full).toContainText('Full');
 await page.getByRole('checkbox',{name:'Hide full times'}).click();await expect(full).toHaveCount(0);await expect(openSlot(page)).toBeVisible();
 await page.getByRole('checkbox',{name:'Hide full times'}).click();await full.click();
 const card=page.locator('.pz-pop');await expect(card).toBeVisible();for(const name of ['Jane','Sam','Alex'])await expect(card.getByText(name,{exact:true})).toBeVisible();
 await page.getByRole('heading',{name:'Press pause.',exact:true}).click();await expect(card).toHaveCount(0);
 await days.nth(1).click();await expect(days.nth(1)).toHaveAttribute('aria-selected','true');await expect(openSlot(page)).toHaveAccessibleName(/3 places left/);
 expect(errors).toEqual([]);
});

test('switching campaign shows that campaign’s times',async({page})=>{
 const {errors}=await fixture(page);await page.goto('/');
 await page.locator('[data-campaign-choice]').filter({hasText:'Second campaign'}).click();
 await expect(openSlot(page,'11:00 to 11:30')).toBeVisible();await expect(openSlot(page)).toHaveCount(0);
 await page.locator('[data-campaign-choice]').filter({hasText:'Workplace wellness'}).click();await expect(openSlot(page)).toBeVisible();expect(errors).toEqual([]);
});

test('booking: digits-only code, duplicate warning, confirmation pass and calendar file',async({page})=>{
 const {errors,writes}=await fixture(page);await page.goto('/');
 const dialog=await openBooking(page);const confirm=dialog.getByRole('button',{name:'Confirm booking',exact:true});
 await expect(dialog.getByText('With Jane',{exact:true})).toBeVisible();await expect(confirm).toBeDisabled();
 await dialog.getByLabel('Full name',{exact:true}).fill('Test Employee');
 const code=dialog.getByLabel('Employee code',{exact:true});await code.fill('9a9!9');await expect(code).toHaveValue('999');
 await expect(confirm).toBeDisabled();await dialog.getByText('Technology',{exact:true}).click();await expect(confirm).toBeEnabled();
 await confirm.click();await expect(dialog.getByText('This code already has a booking in this campaign.',{exact:true})).toBeVisible();
 await code.fill('1042x');await expect(code).toHaveValue('1042');await expect(dialog.getByText('This code already has a booking in this campaign.',{exact:true})).toHaveCount(0);await expect(confirm).toBeEnabled();
 await confirm.click();
 await expect(page.getByRole('heading',{name:'You’re booked, Test Employee.',exact:true})).toBeVisible();
 await expect(page.locator('[data-booking-success]')).toBeVisible();await expect(page.getByText('booking-reference',{exact:true})).toBeVisible();
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Add to calendar',exact:true}).click();const download=await downloadPromise;
 expect(download.suggestedFilename()).toMatch(/^pause-booking-.*\.ics$/);const contents=await readFile((await download.path())!,'utf8');
 expect(contents).toContain('DTSTART;TZID=Indian/Mauritius:'+day.replaceAll('-','')+'T090000');expect(contents).toContain('SUMMARY:Workplace wellness');expect(contents).not.toContain('1042');
 await page.getByRole('button',{name:'Done',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 const requests=writes.filter(w=>w.name==='create_booking');expect(requests).toHaveLength(2);expect(requests[1].body.p_employee_code).toBe('1042');expect(requests[1].body.p_sbu).toBe('Technology');expect(errors).toEqual([]);
});

test('a time that fills up offers the closest free time and keeps the details',async({page})=>{
 const {slots,writes,errors}=await fixture(page);await page.goto('/');
 const dialog=await openBooking(page);await fillDetails(page,'Alex Morgan','1042');
 slots[0].booked_count=slots[0].capacity;
 await dialog.getByRole('button',{name:'Confirm booking',exact:true}).click();
 await expect(dialog.getByRole('heading',{name:'Someone booked the last place a moment ago.'})).toBeVisible();
 await expect(dialog.getByText('Just taken',{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Confirm booking',exact:true})).toHaveCount(0);
 const option=dialog.getByRole('button',{name:/^Switch to 09:00/});await expect(option).toHaveCount(1);await option.click();
 await expect(dialog.getByText('Just taken',{exact:true})).toHaveCount(0);
 await expect(dialog.getByLabel('Full name',{exact:true})).toHaveValue('Alex Morgan');await expect(dialog.getByLabel('Employee code',{exact:true})).toHaveValue('1042');
 await dialog.getByRole('button',{name:'Confirm booking',exact:true}).click();await expect(page.getByRole('heading',{name:'You’re booked, Alex Morgan.',exact:true})).toBeVisible();
 const requests=writes.filter(w=>w.name==='create_booking');expect(requests).toHaveLength(2);expect(requests[1].body.p_slot_id).toBe('s3');expect(requests[1].body.p_request_id).not.toBe(requests[0].body.p_request_id);expect(errors).toEqual([]);
});

test('a filled time can also send the person back to all times',async({page})=>{
 const {slots,errors}=await fixture(page);await page.goto('/');
 const dialog=await openBooking(page);await fillDetails(page,'Alex Morgan','1042');slots[0].booked_count=slots[0].capacity;
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(dialog.getByRole('heading',{name:'Someone booked the last place a moment ago.'})).toBeVisible();
 await dialog.getByRole('button',{name:'See all times',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.getByRole('checkbox',{name:'Hide full times'})).toBeChecked();await expect(page.locator('[data-date-choice]').nth(1)).toHaveAttribute('aria-selected','true');
 const again=await openBooking(page);await expect(again.getByLabel('Full name',{exact:true})).toHaveValue('Alex Morgan');expect(errors).toEqual([]);
});

test('more than eight business units become a searchable list',async({page})=>{
 const {errors}=await fixture(page);
 const many=['Audit','Compliance','Finance','HR','Legal','Marketing','Operations','Other','Sales','Technology','Treasury'];
 await page.route('**/rest/v1/sbus**',route=>route.fulfill({json:many.map(name=>({name})),headers:{'access-control-allow-origin':'*','content-range':'0-10/11'}}));
 await page.goto('/');const dialog=await openBooking(page);
 await expect(dialog.getByRole('radio')).toHaveCount(0);const search=dialog.locator('#booking-sbu-search');await expect(search).toBeVisible();
 await expect(dialog.locator('.pz-list-item')).toHaveCount(many.length);await expect(dialog.locator('.pz-list-item').last()).toHaveText('Other');
 await search.fill('tec');await expect(dialog.locator('.pz-list-item')).toHaveText(['Technology']);await search.press('Enter');
 await expect(dialog.locator('.pz-picked')).toContainText('Technology');await dialog.getByRole('button',{name:'Change',exact:true}).click();await expect(dialog.locator('#booking-sbu-search')).toBeVisible();
 expect(errors).toEqual([]);
});

test('booking page and dialog fit a phone without sideways scrolling',async({page})=>{
 const {errors}=await fixture(page,false,false,true);await page.setViewportSize({width:375,height:812});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
 await expect(page.locator('[data-date-choice]')).toHaveCount(14);await expect(openSlot(page)).toBeVisible();expect(await noOverflow(page)).toBe(false);
 const dialog=await openBooking(page);expect(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(false);
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);expect(await noOverflow(page)).toBe(false);expect(errors).toEqual([]);
});

// ---------------------------------------------------------------- Admin

test('sign-in submits with Enter without sending a real email',async({page})=>{
 const {errors}=await fixture(page);let direct=0;page.on('request',r=>{if(r.url().includes('/auth/v1/otp'))direct++;});
 await page.route('**/functions/v1/request-admin-sign-in',r=>r.fulfill({json:{message:'If this email has admin access, you’ll receive a sign-in link.'}}));
 await page.goto('/bk-admin-codex/login');await expect(page.getByRole('heading',{name:'Sign in to Pause',exact:true})).toBeVisible();
 await page.getByLabel('Email address',{exact:true}).fill('admin@example.test');await page.getByLabel('Email address',{exact:true}).press('Enter');
 await expect(page.getByRole('heading',{name:'Check your email',exact:true})).toBeVisible();expect(direct).toBe(0);expect(errors).toEqual([]);
});

test('admin lives on its own route and the old route shows the booking page',async({page})=>{
 await fixture(page);await page.goto('/admin');await expect(page.getByRole('heading',{name:'Press pause.',exact:true})).toBeVisible();
 await page.goto('/bk-admin-codex');await expect(page.getByRole('heading',{name:'Sign in to Pause',exact:true})).toBeVisible();
});

test('campaign list: summary, fill, row opens the editor, status switch asks first',async({page})=>{
 const {errors,writes}=await fixture(page,true);await page.goto('/bk-admin-codex');
 await expect(page.getByRole('heading',{name:'Campaigns',exact:true})).toBeVisible();await expect(page.locator('.pa-stat')).toHaveCount(4);
 const row=adminRow(page,'Workplace wellness');await expect(row.getByText('4 of 9')).toBeVisible();await expect(row.getByText(/^Next: /).first()).toBeVisible();
 await expect(page.getByRole('columnheader',{name:'Last saved'})).toHaveCount(0);await expect(page.getByRole('button',{name:'View bookings',exact:true})).toHaveCount(0);
 const toggle=row.getByRole('switch',{name:'Accept bookings for Workplace wellness'});await expect(toggle).toHaveAttribute('aria-checked','true');
 await toggle.click();const close=page.getByRole('alertdialog',{name:'Close bookings?',exact:true});await close.getByRole('button',{name:'Cancel',exact:true}).click();await expect(close).toHaveCount(0);
 expect(writes.filter(w=>w.name==='set_campaign_status')).toHaveLength(0);await expect(toggle).toHaveAttribute('aria-checked','true');
 await toggle.click();await close.getByRole('button',{name:'Close bookings',exact:true}).click();await expect(page.getByText('Bookings closed.',{exact:true})).toBeVisible();
 expect(writes.filter(w=>w.name==='set_campaign_status')).toHaveLength(1);await expect(adminRow(page,'Workplace wellness').getByRole('switch')).toHaveAttribute('aria-checked','false');
 await page.getByRole('button',{name:'Open Second campaign to edit',exact:true}).click();await expect(page.getByRole('heading',{name:'Edit campaign',exact:true})).toBeVisible();
 await expect(page.getByLabel('Campaign name',{exact:true})).toHaveValue('Second campaign');expect(errors).toEqual([]);
});

test('status filter chips reload the list',async({page})=>{
 const {errors}=await fixture(page,true);const seen:string[]=[];page.on('request',r=>{const url=new URL(r.url());if(url.pathname.endsWith('/campaigns')&&url.searchParams.get('status'))seen.push(url.searchParams.get('status')!);});
 await page.goto('/bk-admin-codex');const group=page.getByRole('group',{name:'Filter by status'});
 await expect(group.getByRole('button',{name:'All',exact:true})).toHaveAttribute('aria-pressed','true');await group.getByRole('button',{name:'Unpublished',exact:true}).click();
 await expect(group.getByRole('button',{name:'Unpublished',exact:true})).toHaveAttribute('aria-pressed','true');await expect.poll(()=>seen).toContain('eq.draft');expect(errors).toEqual([]);
});

test('campaign editor: date cards, visibility choice, save and delete confirmations',async({page})=>{
 const {errors,writes}=await fixture(page,true);await page.goto('/bk-admin-codex');
 await page.getByRole('button',{name:'New campaign',exact:true}).click();await page.getByLabel('Campaign name',{exact:true}).fill('New wellness campaign');
 await expect(page.locator('.pa-preview-name')).toHaveText('New wellness campaign');await expect(page.getByRole('heading',{name:'No dates yet',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Add a date',exact:true}).click();
 const dateDialog=page.getByRole('dialog',{name:'Add date',exact:true});await dateDialog.getByLabel('Date',{exact:true}).click();await page.getByRole('button',{name:'Go to the next month',exact:true}).click();await page.getByRole('grid').getByRole('gridcell',{name:'15',exact:true}).click();await expect(page.getByRole('grid')).toHaveCount(0);
 await dateDialog.getByRole('button',{name:'Start',exact:true}).click();await chooseOption(page,'#start-hour','10');await chooseOption(page,'#start-minute','15');await page.getByRole('button',{name:'Done',exact:true}).click();
 await dateDialog.getByRole('button',{name:'End',exact:true}).click();await chooseOption(page,'#end-hour','13');await chooseOption(page,'#end-minute','45');await page.getByRole('button',{name:'Done',exact:true}).click();
 await dateDialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dateDialog).toHaveCount(0);
 const card=page.locator('.pa-date');await expect(card).toHaveCount(1);await expect(card).toContainText('10:15 to 13:45');await expect(card.getByText('New, not saved yet',{exact:true})).toBeVisible();
 await expect(page.getByRole('radio',{name:/Keep private/})).toBeChecked();await page.getByText('Open for bookings',{exact:true}).click();await expect(page.getByRole('radio',{name:/Open for bookings/})).toBeChecked();
 await page.getByRole('button',{name:'Save and publish',exact:true}).click();const confirmation=page.getByRole('alertdialog',{name:'Save and publish campaign?',exact:true});await confirmation.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(confirmation).toHaveCount(0);expect(writes.filter(w=>w.name==='save_campaign_v2')).toHaveLength(0);
 await page.getByRole('button',{name:'Save and publish',exact:true}).click();await page.getByRole('button',{name:'Confirm and publish',exact:true}).click();await expect(page.getByText('Campaign published. Bookings are open.',{exact:true})).toBeVisible();
 const saved=JSON.stringify(writes.find(w=>w.name==='save_campaign_v2')?.body);expect(saved).toContain('-15');expect(saved).toContain('10:15');expect(saved).toContain('13:45');
 await page.getByRole('button',{name:'More actions for Workplace wellness',exact:true}).click();await page.getByRole('menuitem',{name:'Delete campaign',exact:true}).click();
 const deletion=page.getByRole('alertdialog',{name:'Delete campaign?',exact:true});await deletion.getByRole('button',{name:'Keep campaign',exact:true}).click();await expect(deletion).toHaveCount(0);expect(writes.filter(w=>w.name==='delete_campaign')).toHaveLength(0);expect(errors).toEqual([]);
});

test('editing a saved campaign locks dates that have bookings',async({page})=>{
 const {errors}=await fixture(page,true);await page.goto('/bk-admin-codex');await page.getByRole('button',{name:'Open Workplace wellness to edit',exact:true}).click();
 const cards=page.locator('.pa-date');await expect(cards).toHaveCount(2);
 await expect(cards.first()).toContainText('4 booked');await expect(cards.first().getByText('Has bookings',{exact:true})).toBeVisible();await expect(cards.first().getByRole('button')).toHaveCount(0);
 await expect(cards.nth(1).getByRole('button',{name:/^Edit scheduled date/})).toBeVisible();await expect(cards.nth(1).getByRole('button',{name:/^Remove scheduled date/})).toBeVisible();expect(errors).toEqual([]);
});

test('bookings: grouped by day and time, edit with review, digits-only code',async({page})=>{
 const {errors,writes}=await fixture(page,true);await page.goto('/bk-admin-codex');
 await adminRow(page,'Workplace wellness').getByRole('button',{name:/^View bookings for Workplace wellness/}).click();
 await expect(page.getByRole('heading',{name:'Bookings',exact:true})).toBeVisible();await expect(page.locator('.pa-day-title')).toHaveCount(1);await expect(page.locator('.pa-slotrow')).toContainText('09:00');
 await page.getByRole('button',{name:'Open booking for Jane',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Edit booking',exact:true});
 const code=dialog.getByLabel('Employee code',{exact:true});await code.fill('27x!');await expect(code).toHaveValue('27');await expect(dialog.getByRole('button',{name:'Save booking',exact:true})).toBeDisabled();
 await dialog.getByLabel('Full name',{exact:true}).fill('Jane Updated');await dialog.getByRole('button',{name:'Save booking',exact:true}).click();
 const review=page.getByRole('alertdialog',{name:'Review booking changes'});await expect(review.getByRole('cell',{name:'Jane Updated',exact:true})).toBeVisible();await expect(review.getByRole('cell',{name:'Employee code',exact:true})).toHaveCount(0);
 await review.getByRole('button',{name:'Back to editing'}).click();await expect(dialog.getByLabel('Full name',{exact:true})).toHaveValue('Jane Updated');expect(writes.filter(w=>w.name==='update_booking')).toHaveLength(0);
 await dialog.getByRole('button',{name:'Save booking',exact:true}).click();await review.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect(page.getByText('Booking updated.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Open booking for Jane Updated',exact:true})).toBeVisible();
 expect(writes.filter(w=>w.name==='update_booking')).toHaveLength(1);expect(errors).toEqual([]);
});

test('bookings: search highlight, list download and cancellation',async({page})=>{
 const {errors,writes}=await fixture(page,true);await page.goto('/bk-admin-codex');
 await adminRow(page,'Workplace wellness').getByRole('button',{name:/^View bookings for Workplace wellness/}).click();
 await page.getByLabel('Find an employee').fill('jan');await expect(page.locator('.pa-hit').first()).toHaveText('Jan');
 await page.getByLabel('Find an employee').fill('nobody');await expect(page.getByRole('heading',{name:'No bookings match',exact:true})).toBeVisible();await page.getByRole('button',{name:'Clear filters',exact:true}).click();
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download list',exact:true}).click();const download=await downloadPromise;
 expect(download.suggestedFilename()).toBe('pause-bookings-workplace-wellness.csv');const csv=await readFile((await download.path())!,'utf8');expect(csv).toContain('Date,Start,End,Name,Employee code,Business unit,Status');expect(csv).toContain('Jane,27,Technology,Confirmed');
 await page.getByRole('button',{name:'Actions for Jane',exact:true}).click();await page.getByRole('menuitem',{name:'Cancel booking',exact:true}).click();
 const confirmation=page.getByRole('alertdialog',{name:'Cancel this booking?',exact:true});await confirmation.getByRole('button',{name:'Keep booking',exact:true}).click();await expect(confirmation).toHaveCount(0);expect(writes.filter(w=>w.name==='cancel_booking')).toHaveLength(0);
 await page.getByRole('button',{name:'Actions for Jane',exact:true}).click();await page.getByRole('menuitem',{name:'Cancel booking',exact:true}).click();await confirmation.getByRole('button',{name:'Cancel booking',exact:true}).click();
 await expect(page.getByText('Booking cancelled.',{exact:true})).toBeVisible();expect(writes.filter(w=>w.name==='cancel_booking')).toHaveLength(1);
 await page.getByRole('button',{name:'Cancelled',exact:true}).click();await expect(page.getByText(/Cancelled by Jane Admin/)).toBeVisible();expect(errors).toEqual([]);
});

test('business units: add, remove with undo, and save',async({page})=>{
 const {errors,writes}=await fixture(page,true);await page.goto('/bk-admin-codex');await page.getByRole('button',{name:'Business units',exact:true}).click();
 const list=page.getByRole('list',{name:'Business units',exact:true});await expect(list.getByRole('listitem')).toHaveCount(3);await expect(list.getByRole('listitem').last()).toContainText('Other');
 const save=page.getByRole('button',{name:'Save changes',exact:true});await expect(save).toBeDisabled();await expect(page.getByText('Everything is saved.',{exact:true})).toBeVisible();
 const add=page.getByLabel('Add a business unit',{exact:true});await add.fill('Finance, cxo');await add.press('Enter');
 await expect(list.getByRole('listitem')).toHaveCount(4);await expect(page.getByText('“cxo” is already in the list.',{exact:true})).toBeVisible();await expect(list.getByRole('listitem').filter({hasText:'Finance'})).toContainText('New');
 await page.getByRole('button',{name:'Remove CXO',exact:true}).click();await expect(page.getByText('Removed when you save:',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Keep CXO',exact:true}).click();await expect(list.getByRole('listitem')).toHaveCount(4);
 await expect(page.getByText('You have unsaved changes.',{exact:true})).toBeVisible();await save.click();await expect(page.getByText('Business units saved.',{exact:true})).toBeVisible();
 const request=writes.filter(w=>w.name==='save_sbus');expect(request).toHaveLength(1);expect(request[0].body.p_names).toContain('Finance');await expect(page.getByText('Everything is saved.',{exact:true})).toBeVisible();expect(errors).toEqual([]);
});

test('administrators: no editing of others, add, and access switch with confirmation',async({page})=>{
 const {errors,writes}=await fixture(page,true);await page.goto('/bk-admin-codex');await page.getByRole('button',{name:'Administrators',exact:true}).click();
 const people=page.getByRole('list',{name:'Administrators',exact:true});await expect(people.getByRole('listitem')).toHaveCount(2);
 await expect(people.getByRole('button',{name:/^Edit/})).toHaveCount(0);await expect(page.getByRole('switch',{name:'Access for Jane Admin',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Add administrator',exact:true}).click();const add=page.getByRole('dialog',{name:'Add administrator',exact:true});
 await add.getByLabel('Full name',{exact:true}).fill('New Admin');await add.getByLabel('Email address',{exact:true}).fill('new@example.test');await add.getByRole('button',{name:'Save administrator',exact:true}).click();await expect(add).toHaveCount(0);
 const access=page.getByRole('switch',{name:'Access for New Admin',exact:true});await expect(access).toHaveAttribute('aria-checked','true');
 await access.click();let confirmation=page.getByRole('alertdialog',{name:'Deactivate administrator?',exact:true});await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();await expect(confirmation).toHaveCount(0);expect(writes.filter(w=>w.name==='set_administrator_status')).toHaveLength(0);
 await access.click();await confirmation.getByRole('button',{name:'Deactivate',exact:true}).click();await expect(access).toHaveAttribute('aria-checked','false');
 await access.click();confirmation=page.getByRole('alertdialog',{name:'Reactivate administrator?',exact:true});await confirmation.getByRole('button',{name:'Reactivate',exact:true}).click();await expect(access).toHaveAttribute('aria-checked','true');
 expect(writes.filter(w=>w.name==='save_administrator')).toHaveLength(1);expect(writes.filter(w=>w.name==='set_administrator_status')).toHaveLength(2);expect(errors).toEqual([]);
});

test('account menu: edit own name only, then sign out with confirmation',async({page})=>{
 const {errors,writes}=await fixture(page,true);await page.goto('/bk-admin-codex');
 const trigger=page.getByRole('button',{name:'Account menu for Jane Admin',exact:true});await trigger.click();
 await expect(page.getByRole('menuitem',{name:'Employee bookings'})).toHaveCount(0);await page.getByRole('menuitem',{name:'Edit profile',exact:true}).click();
 const profile=page.getByRole('dialog',{name:'Edit profile',exact:true});await expect(profile.getByText('admin@example.test',{exact:true})).toBeVisible();await expect(profile.getByRole('textbox')).toHaveCount(1);
 const save=profile.getByRole('button',{name:'Save name',exact:true});await expect(save).toBeDisabled();await profile.getByLabel('Full name',{exact:true}).fill('Jane Renamed');await save.click();
 await expect(profile).toHaveCount(0);await expect(page.getByText('Profile updated.',{exact:true})).toBeVisible();
 const request=writes.filter(w=>w.name==='save_administrator');expect(request).toHaveLength(1);expect(request[0].body.p_email).toBe('admin@example.test');expect(request[0].body.p_full_name).toBe('Jane Renamed');
 let signOutRequests=0;page.on('request',r=>{if(r.url().includes('/auth/v1/logout'))signOutRequests++;});
 await page.getByRole('button',{name:/^Account menu for /}).click();await page.getByRole('menuitem',{name:'Sign out',exact:true}).click();
 const confirmation=page.getByRole('alertdialog',{name:'Sign out?',exact:true});await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();await expect(confirmation).toHaveCount(0);expect(signOutRequests).toBe(0);
 await page.getByRole('button',{name:/^Account menu for /}).click();await page.getByRole('menuitem',{name:'Sign out',exact:true}).click();await confirmation.getByRole('button',{name:'Sign out',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Sign in to Pause',exact:true})).toBeVisible();expect(signOutRequests).toBe(1);expect(errors).toEqual([]);
});

test('admin fits a phone: navigation drawer, campaigns and bookings',async({page})=>{
 const {errors}=await fixture(page,true);await page.setViewportSize({width:375,height:812});await page.goto('/bk-admin-codex');
 await expect(page.getByRole('heading',{name:'Campaigns',exact:true})).toBeVisible();expect(await noOverflow(page)).toBe(false);
 await page.getByRole('button',{name:'Open navigation',exact:true}).click();const drawer=page.getByRole('dialog',{name:'Sidebar',exact:true});
 await drawer.getByRole('button',{name:'Bookings',exact:true}).click();await expect(drawer).toHaveCount(0);await expect(page.getByRole('heading',{name:'Bookings',exact:true})).toBeVisible();
 await chooseOption(page,'#bookings-campaign','Workplace wellness');await expect(page.getByRole('button',{name:'Open booking for Jane',exact:true})).toBeVisible();expect(await noOverflow(page)).toBe(false);expect(errors).toEqual([]);
});

test('icons are served on the booking page and the admin',async({page})=>{
 await fixture(page,true);
 for(const path of ['/','/bk-admin-codex']){
  await page.goto(path);const favicon=page.locator('link[rel="icon"][sizes="32x32"]');await expect(favicon).toHaveAttribute('href','brand/favicon-32x32.png?v=2');
  for(const asset of ['/favicon.ico?v=2','/brand/favicon-32x32.png?v=2','/brand/favicon-16x16.png?v=2']){const response=await page.request.get(asset);expect(response.status()).toBe(200);expect(response.headers()['content-type']).not.toContain('text/html');}
  const svg=await page.request.get('/brand/pause-icon.svg');expect(svg.status()).toBe(200);expect(await svg.text()).toContain('viewBox="0 0 64 64"');
 }
});
