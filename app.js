(function(){
  'use strict';
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  var canvas=document.getElementById('radar');
  var ctx=canvas.getContext('2d');
  var width,height,ratio,dots=[],angle=0,last=0;
  function resize(){
    ratio=Math.min(window.devicePixelRatio||1,1.5);
    width=canvas.width=window.innerWidth*ratio;
    height=canvas.height=window.innerHeight*ratio;
    canvas.style.width=window.innerWidth+'px';canvas.style.height=window.innerHeight+'px';
    dots=Array.from({length:Math.max(14,Math.round(window.innerWidth*window.innerHeight/43000))},function(){return{x:Math.random()*width,y:Math.random()*height,r:(.4+Math.random())*ratio,a:.06+Math.random()*.2}});
  }
  function draw(time){
    window.requestAnimationFrame(draw);if(time-last<34)return;last=time;ctx.clearRect(0,0,width,height);
    var x=width*.72,y=height*.2,radius=Math.max(width,height)*.78;
    ctx.strokeStyle='rgba(255,107,44,.055)';ctx.lineWidth=ratio;
    for(var i=1;i<5;i++){ctx.beginPath();ctx.arc(x,y,radius*i/5,0,Math.PI*2);ctx.stroke()}
    angle+=.006;
    if(ctx.createConicGradient){var gradient=ctx.createConicGradient(angle,x,y);gradient.addColorStop(0,'rgba(255,107,44,.095)');gradient.addColorStop(.05,'rgba(255,107,44,0)');gradient.addColorStop(1,'rgba(255,107,44,0)');ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fill()}
    dots.forEach(function(dot){ctx.fillStyle='rgba(255,156,99,'+dot.a+')';ctx.beginPath();ctx.arc(dot.x,dot.y,dot.r,0,Math.PI*2);ctx.fill()});
  }
  resize();window.addEventListener('resize',resize,{passive:true});window.requestAnimationFrame(draw);
})();

(function(){
  'use strict';
  var matrix=document.querySelector('.matrix');if(!matrix)return;
  var cells=matrix.querySelectorAll('.m-cell');
  cells.forEach(function(cell){
    var g=[],cl=cell.classList;
    if(cl.contains('nav-cyan')||cl.contains('nav-head'))g.push('cyan');
    if(cl.contains('learn-head')||cl.contains('fill-learn'))g.push('learn');
    if(cl.contains('red-head')||cl.contains('cert-normal-head'))cell.dataset.link='learn'; /* 觸碰「學習操作證」時，僅這兩個表頭一起亮起（單向） */
    if(cl.contains('pro')||cl.contains('fill-pro')||cl.contains('red-head'))g.push('pro');
    if(cl.contains('normal')||cl.contains('fill-normal')||cl.contains('cert-normal-head'))g.push('normal');
    if((cl.contains('free')&&!cl.contains('nav-cyan'))||cl.contains('model-head'))g.push('free');
    if(cl.contains('cert-plain-head')&&!cl.contains('learn-head'))g.push('cyan','free');
    if(g.length){cell.dataset.group=g.join(' ');if(cl.contains('m-head'))cell.setAttribute('tabindex','0')}
  });
  var current=null,lastTouch=0;
  function hit(cell,groups){if(cell.dataset.link&&groups.indexOf(cell.dataset.link)>-1)return true;return cell.dataset.group.split(' ').some(function(x){return groups.indexOf(x)>-1})}
  function setGroup(g){
    if(g===current)return;current=g;
    var groups=g?g.split(' '):[];
    matrix.classList.toggle('has-active',!!g);
    cells.forEach(function(cell){cell.classList.toggle('is-active',!!g&&!!cell.dataset.group&&hit(cell,groups))});
  }
  function from(target){var el=target&&target.closest?target.closest('[data-group]'):null;return el?el.dataset.group:null}
  matrix.addEventListener('mouseover',function(e){if(Date.now()-lastTouch<800)return;setGroup(from(e.target))});
  matrix.addEventListener('mouseleave',function(){setGroup(null)});
  matrix.addEventListener('focusin',function(e){setGroup(from(e.target))});
  matrix.addEventListener('focusout',function(e){if(!matrix.contains(e.relatedTarget))setGroup(null)});
  matrix.addEventListener('touchstart',function(e){lastTouch=Date.now();var g=from(e.target);setGroup(g===current?null:g)},{passive:true});
})();
