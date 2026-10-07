(() => {
'use strict';
const $ = s => document.querySelector(s);
const WMO = {0:['sunny','Ciel dégagé','clear'],1:['partly-cloudy','Plutôt dégagé','clear'],2:['partly-cloudy','Partiellement nuageux','cloud'],3:['cloudy','Couvert','cloud'],
45:['fog','Brouillard','cloud'],48:['fog','Brouillard givrant','cloud'],51:['drizzle','Bruine légère','rain'],53:['drizzle','Bruine','rain'],55:['drizzle','Bruine dense','rain'],
61:['rain','Pluie faible','rain'],63:['rain','Pluie','rain'],65:['rain','Pluie forte','rain'],71:['snow','Neige faible','snow'],73:['snow','Neige','snow'],75:['snow','Neige forte','snow'],
80:['showers','Averses','rain'],81:['rain','Averses fortes','rain'],82:['storm','Averses violentes','rain'],95:['storm','Orage','rain'],96:['storm','Orage et grêle','rain'],99:['storm','Orage violent','rain']};
const KEYS = Object.keys(WMO).map(Number);
const info = c => WMO[c] || WMO[KEYS.reduce((p,k) => Math.abs(k-c) < Math.abs(p-c) ? k : p, 0)];
const normalizeCityName = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();
let data = null, chart = null, mode = 'daily', fxType = 'clear';
let suggestionTimer = null, suggestionRequest = null, suggestions = [], activeSuggestion = -1;
const cityInput = $('#q'), cityList = $('#citySuggestions');

/* ---------- API ---------- */
async function searchCities(name, signal){
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=fr&format=json`, {signal});
  if(!r.ok) throw new Error('Service de recherche indisponible');
  const j = await r.json();
  const query = normalizeCityName(name);
  return (j.results || []).filter(p => normalizeCityName(p.name).includes(query)).map(p => ({
    lat:p.latitude,
    lon:p.longitude,
    cityName:p.name,
    name:[p.name,p.admin1,p.country].filter((value,index,all) => value && all.indexOf(value) === index).join(', '),
    context:[p.admin1,p.country].filter((value,index,all) => value && value !== p.name && all.indexOf(value) === index).join(', ')
  }));
}
async function forecast(lat, lon){
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`+
  `&current=temperature_2m,apparent_temperature,relative_humidity_2m,pressure_msl,wind_speed_10m,weather_code,is_day`+
   `&hourly=temperature_2m&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=7&timezone=auto`;
  const r = await fetch(u);
  if(!r.ok) throw new Error('Service météo indisponible');
  return r.json();
}
async function load(place){
  setStatus('Chargement…');
  try{
    data = {place, w: await forecast(place.lat, place.lon)};
    localStorage.setItem('mi:last', JSON.stringify(place));
    render();
    setStatus('');
  }catch(e){ setStatus('⚠️ ' + (e.message || 'Erreur réseau')); }
}
function setStatus(t){ $('#status').textContent = t; }
function closeCitySuggestions(){
  cityList.hidden = true;
  cityInput.setAttribute('aria-expanded','false');
  cityInput.removeAttribute('aria-activedescendant');
  activeSuggestion = -1;
}
function showCitySuggestions(cities, message=''){
  suggestions = cities;
  activeSuggestion = -1;
  cityList.replaceChildren();
  if(!cities.length){
    const empty = document.createElement('li');
    empty.className = 'no-city';
    empty.setAttribute('role','option');
    empty.textContent = message || 'Aucune ville trouvée';
    cityList.append(empty);
  }else{
    cities.forEach((city,index) => {
      const option = document.createElement('li');
      option.id = `city-option-${index}`;
      option.dataset.index = index;
      option.setAttribute('role','option');
      option.setAttribute('aria-selected','false');
      const name = document.createElement('span');
      name.textContent = city.cityName;
      option.append(name);
      if(city.context){
        const context = document.createElement('small');
        context.className = 'city-context';
        context.textContent = city.context;
        option.append(context);
      }
      cityList.append(option);
    });
  }
  cityList.hidden = false;
  cityInput.setAttribute('aria-expanded','true');
}
function activateSuggestion(index){
  if(!suggestions.length) return;
  activeSuggestion = (index + suggestions.length) % suggestions.length;
  cityList.querySelectorAll('[role="option"][data-index]').forEach((option,i) => {
    option.setAttribute('aria-selected',String(i === activeSuggestion));
  });
  cityInput.setAttribute('aria-activedescendant',`city-option-${activeSuggestion}`);
}
function chooseSuggestion(index){
  const city = suggestions[index];
  if(!city) return;
  if(suggestionRequest) suggestionRequest.abort();
  cityInput.value = city.name;
  closeCitySuggestions();
  load(city);
}

/* ---------- Rendu ---------- */
function render(){
  const {place, w} = data, c = w.current, [iconName, label, fx] = info(c.weather_code);
  fxType = fx;
  $('#place').textContent = place.name;
  const nightIcons = {'sunny':'clear-night','partly-cloudy':'partly-cloudy-night'};
  const currentIcon = c.is_day === 0 ? (nightIcons[iconName] || iconName) : iconName;
  $('#icon').innerHTML = `<img src="assets/weather/${currentIcon}.svg" alt="${label}" title="${label}">`;
  $('#temp').textContent = Math.round(c.temperature_2m);
  $('#desc').textContent = label;
  $('#feel').textContent = Math.round(c.apparent_temperature) + '°C';
  $('#hum').textContent = c.relative_humidity_2m + ' %';
  $('#wind').textContent = Math.round(c.wind_speed_10m) + ' km/h';
  $('#pres').textContent = Math.round(c.pressure_msl) + ' hPa';
  $('#current').hidden = $('#chartBox').hidden = false;
  const d = w.daily;
  $('#days').innerHTML = d.time.map((t,i) => {
    const day = new Date(t).toLocaleDateString('fr-FR',{weekday:'short',day:'numeric'});
    const [iconName, label] = info(d.weather_code[i]);
    return `<article class="day tilt reveal"><b>${day}</b><div class="e"><img src="assets/weather/${iconName}.svg" alt="${label}" title="${label}"></div>
      <span class="mx">${Math.round(d.temperature_2m_max[i])}°</span> <span class="mn">${Math.round(d.temperature_2m_min[i])}°</span></article>`;
  }).join('');
  bind(); drawChart();
}
function drawChart(){
  if(typeof Chart === 'undefined'){ setStatus('Chart.js non chargé (connexion ?)'); return; }
  const {w} = data, ctx = $('#chart').getContext('2d');
  const grad = ctx.createLinearGradient(0,0,0,280);
  grad.addColorStop(0,'rgba(102,126,234,.6)'); grad.addColorStop(1,'rgba(118,75,162,0)');
  let labels, sets;
  if(mode === 'daily'){
    labels = w.daily.time.map(t => new Date(t).toLocaleDateString('fr-FR',{weekday:'short'}));
    sets = [
      {label:'Max °C', data:w.daily.temperature_2m_max, borderColor:'#ff8a65', backgroundColor:'#ff8a6533'},
      {label:'Min °C', data:w.daily.temperature_2m_min, borderColor:'#667eea', backgroundColor:grad, fill:true}];
  } else {
    const now = new Date(w.current.time).getTime(), idx = [];
    w.hourly.time.forEach((t,i) => { const ms = new Date(t).getTime(); if(ms >= now - 36e5 && idx.length < 48) idx.push(i); });
    labels = idx.map(i => new Date(w.hourly.time[i]).toLocaleTimeString('fr-FR',{weekday:'short',hour:'2-digit',minute:'2-digit'}));
    sets = [{label:'Température °C', data:idx.map(i => w.hourly.temperature_2m[i]), borderColor:'#667eea', backgroundColor:grad, fill:true}];
  }
  sets.forEach(s => Object.assign(s,{tension:.4,borderWidth:3,pointRadius:mode==='daily'?4:0,pointHoverRadius:7}));
  if(chart) chart.destroy();
  chart = new Chart(ctx,{type:'line',data:{labels,datasets:sets},options:{
    responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
    animation:{duration:1200,easing:'easeOutQuart'},
    plugins:{legend:{labels:{color:'#ccd'}}},
    scales:{x:{ticks:{color:'#aab',maxTicksLimit:8},grid:{color:'#ffffff0d'}},y:{ticks:{color:'#aab',callback:v=>v+'°'},grid:{color:'#ffffff0d'}}}}});
}

/* ---------- Effets : tilt 3D, reveal, curseur ---------- */
const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && e.target.classList.add('in')), {threshold:.1});
function bind(){
  document.querySelectorAll('.reveal:not(.bound)').forEach((el,i) => { el.classList.add('bound'); el.style.transitionDelay = (i%8)*60+'ms'; io.observe(el); });
  document.querySelectorAll('.tilt:not(.tl)').forEach(el => {
    el.classList.add('tl');
    el.addEventListener('mousemove', e => { const r = el.getBoundingClientRect();
      const x = (e.clientX-r.left)/r.width-.5, y = (e.clientY-r.top)/r.height-.5;
      el.style.transform = `rotateY(${x*14}deg) rotateX(${-y*14}deg) scale(1.03)`; el.style.transitionDelay='0ms'; });
    el.addEventListener('mouseleave', () => el.style.transform = '');
  });
}
const cur = $('#cursor');
addEventListener('mousemove', e => { cur.style.left = e.clientX+'px'; cur.style.top = e.clientY+'px'; });
document.addEventListener('mouseover', e => cur.classList.toggle('big', !!e.target.closest('button,input,a')));

/* Fond animé selon la météo */
const cv = $('#fx'), g = cv.getContext('2d'); let P = [];
function size(){ cv.width = innerWidth; cv.height = innerHeight; }
addEventListener('resize', size); size();
for(let i=0;i<140;i++) P.push({x:Math.random()*cv.width, y:Math.random()*cv.height, z:Math.random()*.8+.2, r:Math.random()*2+1});
(function loop(){
  g.clearRect(0,0,cv.width,cv.height);
  for(const p of P){
    if(fxType === 'rain'){ g.strokeStyle = `rgba(150,180,255,${.2+p.z*.4})`; g.beginPath(); g.moveTo(p.x,p.y); g.lineTo(p.x-2,p.y+12*p.z+4); g.stroke(); p.y += 10*p.z+4; p.x -= 1; }
    else if(fxType === 'snow'){ g.fillStyle = `rgba(255,255,255,${.3+p.z*.5})`; g.beginPath(); g.arc(p.x,p.y,p.r*p.z+1,0,6.3); g.fill(); p.y += 1.2*p.z+.4; p.x += Math.sin(p.y/30); }
    else { g.fillStyle = fxType==='clear' ? `rgba(255,220,130,${.1+p.z*.35})` : `rgba(200,210,255,${.08+p.z*.2})`; g.beginPath(); g.arc(p.x,p.y,p.r*p.z*(fxType==='clear'?1.6:2.6),0,6.3); g.fill(); p.y -= .25*p.z; p.x += .15; }
    if(p.y > cv.height) p.y = -10;
    if(p.y < -10) p.y = cv.height;
    if(p.x > cv.width) p.x = 0;
    if(p.x < 0) p.x = cv.width;
  }
  requestAnimationFrame(loop);
})();

/* ---------- Événements ---------- */
cityInput.addEventListener('input', () => {
  const query = cityInput.value.trim();
  clearTimeout(suggestionTimer);
  if(suggestionRequest) suggestionRequest.abort();
  if(query.length < 2){
    suggestions = [];
    cityList.replaceChildren();
    closeCitySuggestions();
    return;
  }
  suggestionTimer = setTimeout(async () => {
    const controller = new AbortController();
    suggestionRequest = controller;
    try{
      const cities = await searchCities(query, controller.signal);
      if(cityInput.value.trim() === query) showCitySuggestions(cities);
    }catch(err){
      if(err.name !== 'AbortError' && cityInput.value.trim() === query) showCitySuggestions([], 'Recherche indisponible');
    }
  }, 250);
});
cityInput.addEventListener('keydown', event => {
  if(event.key === 'ArrowDown' && !cityList.hidden){
    event.preventDefault();
    activateSuggestion(activeSuggestion + 1);
  }else if(event.key === 'ArrowUp' && !cityList.hidden){
    event.preventDefault();
    activateSuggestion(activeSuggestion < 0 ? suggestions.length - 1 : activeSuggestion - 1);
  }else if(event.key === 'Enter' && activeSuggestion >= 0){
    event.preventDefault();
    chooseSuggestion(activeSuggestion);
  }else if(event.key === 'Escape'){
    closeCitySuggestions();
  }
});
cityList.addEventListener('click', event => {
  const option = event.target.closest('[role="option"][data-index]');
  if(option) chooseSuggestion(Number(option.dataset.index));
});
document.addEventListener('click', event => {
  if(!event.target.closest('.search-field')) closeCitySuggestions();
});
$('#search').addEventListener('submit', async e => {
  e.preventDefault(); const query = cityInput.value.trim(); if(!query) return;
  clearTimeout(suggestionTimer);
  if(suggestionRequest) suggestionRequest.abort();
  try{
    setStatus('Recherche…');
    const cities = await searchCities(query);
    if(!cities.length) throw new Error('Ville introuvable');
    cityInput.value = cities[0].name;
    closeCitySuggestions();
    await load(cities[0]);
  }catch(err){ setStatus('⚠️ ' + err.message); }
});
$('#geo').addEventListener('click', locate);
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.remove('on')); b.classList.add('on');
  mode = b.dataset.mode; if(data) drawChart();
}));
function locate(){
  if(!navigator.geolocation){ setStatus('Géolocalisation non supportée.'); return fallback(); }
  setStatus('Localisation en cours…');
  navigator.geolocation.getCurrentPosition(
    p => load({lat:p.coords.latitude, lon:p.coords.longitude, name:'Ma position'}),
    () => { setStatus('Position refusée, affichage de la dernière ville.'); fallback(); },
    {timeout:8000, maximumAge:600000});
}
function fallback(){
  let last; try{ last = JSON.parse(localStorage.getItem('mi:last')); }catch(e){}
  load(last || {lat:6.3654, lon:2.4183, name:'Cotonou, Bénin'});
}
bind();
addEventListener('load', () => { localStorage.getItem('mi:last') ? fallback() : locate(); });
})();
