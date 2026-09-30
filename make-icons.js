// 아이콘 PNG 생성 (한 번만 실행): node make-icons.js
const zlib = require('zlib'), fs = require('fs');
function crc(buf){let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}let r=0xffffffff;for(const b of buf)r=t[(r^b)&255]^(r>>>8);return (r^0xffffffff)>>>0}
function chunk(type,data){const l=Buffer.alloc(4);l.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])}
function png(size){
  const raw=Buffer.alloc((size*4+1)*size);
  for(let y=0;y<size;y++){raw[y*(size*4+1)]=0;for(let x=0;x<size;x++){
    const i=y*(size*4+1)+1+x*4, u=x/size, v=y/size;
    let r=255-40*v, g=190-50*v, b=110+40*v; // 배경 그라데이션
    // 별 모양(오각별 근사): 중심 거리와 각도
    const dx=u-0.5, dy=v-0.52, d=Math.hypot(dx,dy), a=Math.atan2(dy,dx);
    const rad=0.30*(0.55+0.45*Math.abs(Math.cos(2.5*(a+Math.PI/2))));
    if(d<rad){r=255;g=255;b=255}
    raw[i]=r;raw[i+1]=g;raw[i+2]=b;raw[i+3]=255}}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
fs.writeFileSync('icon-180.png',png(180));fs.writeFileSync('icon-512.png',png(512));
