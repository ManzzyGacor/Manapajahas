// ==========================================================
// ♟️ ManzzyID GRANDMASTER VARESA CHESS (RICH MESSAGE WIDESCREEN)
// Command: .catur / .chess / .gamecatur
// Auto-delete after 3 minutes to keep chat clean.
// ==========================================================

import { randomUUID } from 'crypto';

async function handle(sock, messageInfo) {
    const { remoteJid, sender, command } = messageInfo;

    const userSender = sender || remoteJid;
    const user = global.db?.data?.users?.[userSender];
    if (user) {
        user.exp = (user.exp || 0) + 200;
        user.coin = (user.coin || 0) + 500;
    }

    const html = String.raw`<style>
*{
  box-sizing:border-box;
  -webkit-tap-highlight-color:transparent;
  user-select:none;
  -webkit-user-select:none;
  -webkit-touch-callout:none
}

html,body{
  margin:0;
  padding:0;
  width:100%;
  min-height:100%;
  background:transparent;
  color:#fff;
  font-family:Arial,Helvetica,sans-serif;
  overflow:hidden;
  touch-action:manipulation
}

.wrap{
  width:100%;
  max-width:620px;
  margin:auto;
  padding:7px
}

.card{
  position:relative;
  overflow:hidden;
  border-radius:24px;
  background:linear-gradient(180deg,#171525 0%,#0b0a12 100%);
  border:1px solid rgba(255,255,255,.13);
  box-shadow:
    0 20px 55px rgba(0,0,0,.55),
    inset 0 1px rgba(255,255,255,.08)
}

.glow{
  position:absolute;
  width:240px;
  height:240px;
  left:50%;
  top:190px;
  transform:translateX(-50%);
  background:rgba(105,87,229,.16);
  filter:blur(70px);
  pointer-events:none
}

.header{
  position:relative;
  z-index:2;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  padding:14px 15px;
  border-bottom:1px solid rgba(255,255,255,.08);
  background:rgba(255,255,255,.025)
}

.logo{
  width:43px;
  height:43px;
  display:flex;
  align-items:center;
  justify-content:center;
  border-radius:14px;
  margin-right:10px;
  font-size:25px;
  background:linear-gradient(145deg,#8b79ff,#5541c5);
  box-shadow:
    0 7px 25px rgba(105,87,229,.4),
    inset 0 1px rgba(255,255,255,.25)
}

.brand{
  display:flex;
  align-items:center
}

.mini{
  font-size:8px;
  letter-spacing:2px;
  color:#77748c;
  margin-bottom:4px
}

.title{
  font-size:19px;
  font-weight:900
}

.sub{
  margin-top:3px;
  font-size:9px;
  color:#77748c
}

.status{
  padding:8px 10px;
  border-radius:999px;
  font-size:9px;
  font-weight:900;
  white-space:nowrap;
  border:1px solid rgba(103,230,165,.18);
  background:rgba(103,230,165,.08);
  color:#8ef2bc
}

.main{
  position:relative;
  z-index:1;
  padding:13px 12px 14px
}

.players{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:9px;
  margin-bottom:12px
}

.player{
  padding:10px 11px;
  border-radius:14px;
  background:rgba(255,255,255,.035);
  border:1px solid rgba(255,255,255,.07)
}

.player.active{
  border-color:rgba(105,87,229,.75);
  box-shadow:0 0 22px rgba(105,87,229,.12)
}

.playerTop{
  display:flex;
  align-items:center;
  justify-content:space-between
}

.playerName{
  font-size:10px;
  font-weight:900
}

.playerState{
  margin-top:4px;
  font-size:8px;
  color:#77748c
}

.dot{
  width:8px;
  height:8px;
  border-radius:50%
}

.whiteDot{
  background:#f1f1f1;
  box-shadow:0 0 11px rgba(255,255,255,.7)
}

.blackDot{
  background:#63daf5;
  box-shadow:0 0 11px rgba(99,218,245,.75)
}

.boardWrap{
  width:100%;
  max-width:570px;
  margin:auto;
  padding:7px;
  border-radius:18px;
  background:linear-gradient(145deg,#21243a,#0e101b);
  border:1px solid rgba(255,255,255,.09);
  box-shadow:
    0 14px 35px rgba(0,0,0,.4),
    inset 0 1px rgba(255,255,255,.05)
}

.board{
  width:100%;
  aspect-ratio:1;
  display:grid;
  grid-template-columns:repeat(8,1fr);
  grid-template-rows:repeat(8,1fr);
  overflow:hidden;
  border-radius:11px
}

.square{
  position:relative;
  display:flex;
  align-items:center;
  justify-content:center;
  cursor:pointer;
  transition:filter .12s ease
}

.light{
  background:#d8d2c6
}

.dark{
  background:#606a82
}

.square.selected{
  box-shadow:inset 0 0 0 4px rgba(108,92,231,.95);
  z-index:2
}

.square.last{
  box-shadow:inset 0 0 0 999px rgba(255,214,84,.13)
}

.square.moveHint:after{
  content:"";
  width:19%;
  height:19%;
  border-radius:50%;
  background:rgba(108,92,231,.7);
  position:absolute
}

.square.captureHint:after{
  content:"";
  position:absolute;
  inset:8%;
  border:3px solid rgba(108,92,231,.8);
  border-radius:50%
}

.square.check{
  box-shadow:inset 0 0 0 999px rgba(255,60,80,.34)
}

.piece{
  position:relative;
  z-index:3;
  font-family:"DejaVu Sans","Arial Unicode MS",sans-serif;
  font-size:clamp(30px,8vw,57px);
  line-height:1;
  filter:drop-shadow(0 4px 4px rgba(0,0,0,.25))
}

.whitePiece{
  color:#fff;
  text-shadow:
    0 2px 0 #777,
    0 0 7px rgba(255,255,255,.18)
}

.blackPiece{
  color:#17191e;
  text-shadow:
    0 1px 0 #767b82,
    0 0 7px rgba(0,0,0,.3)
}

.coord{
  position:absolute;
  left:3px;
  bottom:2px;
  font-size:7px;
  font-weight:900;
  opacity:.62;
  z-index:4;
  pointer-events:none
}

.light .coord{
  color:#41485c
}

.dark .coord{
  color:#eef1f8
}

.info{
  display:grid;
  grid-template-columns:1fr 1fr 1fr;
  gap:8px;
  margin-top:10px
}

.infoBox{
  border-radius:12px;
  padding:9px 10px;
  background:rgba(255,255,255,.035);
  border:1px solid rgba(255,255,255,.065);
  text-align:center
}

.infoLabel{
  font-size:7px;
  letter-spacing:1.2px;
  color:#6f6b81
}

.infoValue{
  margin-top:4px;
  font-size:11px;
  font-weight:900
}

.controls{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:8px;
  margin-top:9px
}

.button{
  height:40px;
  border:0;
  border-radius:11px;
  background:rgba(255,255,255,.055);
  border:1px solid rgba(255,255,255,.08);
  color:#fff;
  font-size:9px;
  font-weight:900;
  cursor:pointer
}

.button:active{
  transform:scale(.97)
}

.button:disabled{
  opacity:.4
}

.message{
  min-height:38px;
  margin-top:9px;
  display:flex;
  align-items:center;
  justify-content:center;
  text-align:center;
  padding:8px 10px;
  border-radius:11px;
  background:rgba(255,255,255,.035);
  border:1px solid rgba(255,255,255,.07);
  color:#8a8798;
  font-size:9px;
  line-height:13px
}

.history{
  height:73px;
  overflow:auto;
  margin-top:9px;
  padding:8px 10px;
  border-radius:11px;
  background:rgba(0,0,0,.16);
  border:1px solid rgba(255,255,255,.055);
  color:#838091;
  font-size:8px
}

.historyLine{
  padding:2px 0;
  border-bottom:1px solid rgba(255,255,255,.025)
}

.footer{
  position:relative;
  z-index:2;
  padding:0 0 12px;
  text-align:center;
  font-size:7px;
  letter-spacing:1px;
  color:#565265
}

.startOverlay{
  position:absolute;
  inset:0;
  z-index:50;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:16px;
  background:
    radial-gradient(
      circle at 50% 35%,
      rgba(105,87,229,.18),
      transparent 42%
    ),
    rgba(6,5,12,.90);
  backdrop-filter:blur(14px);
  -webkit-backdrop-filter:blur(14px);
  transition:
    opacity .25s ease,
    visibility .25s ease
}

.startOverlay.hidden{
  opacity:0;
  visibility:hidden;
  pointer-events:none
}

.startPanel{
  width:100%;
  max-width:430px;
  padding:22px;
  border-radius:22px;
  background:
    linear-gradient(
      180deg,
      rgba(31,29,49,.98),
      rgba(12,11,20,.99)
    );
  border:1px solid rgba(255,255,255,.11);
  box-shadow:
    0 30px 90px rgba(0,0,0,.62),
    inset 0 1px rgba(255,255,255,.08);
  text-align:center
}

.startIcon{
  width:62px;
  height:62px;
  margin:0 auto 13px;
  display:flex;
  align-items:center;
  justify-content:center;
  border-radius:18px;
  font-size:31px;
  background:
    linear-gradient(
      145deg,
      #8b79ff,
      #5541c5
    );
  box-shadow:
    0 12px 40px rgba(105,87,229,.35),
    inset 0 1px rgba(255,255,255,.25)
}

.startEyebrow{
  font-size:8px;
  letter-spacing:2.2px;
  color:#76718b;
  font-weight:900
}

.startTitle{
  margin-top:5px;
  font-size:23px;
  font-weight:900
}

.startSub{
  margin-top:6px;
  font-size:9px;
  color:#858096;
  line-height:14px
}

.sideGrid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:10px;
  margin-top:18px
}

.sideBtn{
  position:relative;
  min-height:105px;
  padding:14px 10px;
  border-radius:16px;
  border:1px solid rgba(255,255,255,.08);
  background:
    linear-gradient(
      180deg,
      rgba(255,255,255,.055),
      rgba(255,255,255,.025)
    );
  color:#fff;
  cursor:pointer;
  transition:
    border-color .15s ease,
    background .15s ease,
    transform .15s ease,
    box-shadow .15s ease
}

.sideBtn:active{
  transform:scale(.98)
}

.sideBtn.selected{
  border-color:rgba(118,99,255,.95);
  background:
    linear-gradient(
      180deg,
      rgba(108,92,231,.20),
      rgba(108,92,231,.07)
    );
  box-shadow:
    0 0 28px rgba(108,92,231,.16),
    inset 0 0 0 1px rgba(108,92,231,.15)
}

.sideBtn.selected:before{
  content:"SELECTED";
  position:absolute;
  top:8px;
  right:9px;
  font-size:6px;
  letter-spacing:1px;
  color:#aaa0ff;
  font-weight:900
}

.sidePiece{
  font-size:32px;
  line-height:1
}

.sideName{
  margin-top:9px;
  font-size:9px;
  font-weight:900
}

.sideHint{
  margin-top:4px;
  font-size:7px;
  color:#77738a
}

.matchSummary{
  margin-top:13px;
  min-height:33px;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:7px 10px;
  border-radius:10px;
  background:rgba(255,255,255,.025);
  border:1px solid rgba(255,255,255,.05);
  color:#797489;
  font-size:8px;
  line-height:12px
}

.startBtn{
  width:100%;
  height:43px;
  margin-top:11px;
  border:0;
  border-radius:12px;
  background:
    linear-gradient(
      135deg,
      #8b79ff,
      #5b47cf
    );
  color:#fff;
  font-size:10px;
  font-weight:900;
  cursor:pointer;
  box-shadow:
    0 10px 30px rgba(105,87,229,.25),
    inset 0 1px rgba(255,255,255,.20);
  transition:
    transform .15s ease,
    opacity .15s ease
}

.startBtn:active{
  transform:scale(.98)
}

.startBtn:disabled{
  opacity:.35;
  cursor:default;
  box-shadow:none
}

.startNote{
  margin-top:11px;
  color:#5f5b70;
  font-size:7px;
  line-height:11px
}

@media(max-width:480px){
  body{ padding:0 }
  .wrap{ padding:3px }
  .main{ padding:10px 8px 11px }
  .header{ padding:12px }
  .boardWrap{ padding:5px }
  .startPanel{ padding:18px }
}
</style>

<div class="wrap">
<div class="card">
<div class="glow"></div>

<div class="header">
<div class="brand">
<div class="logo">♚</div>
<div>
<div class="mini">ManzzyID GAME CENTER</div>
<div class="title">VARESA CHESS</div>
<div id="subTitle" class="sub">CHOOSE YOUR SIDE</div>
</div>
</div>
<div id="status" class="status">READY</div>
</div>

<div class="main">
<div class="players">
<div id="whiteCard" class="player">
<div class="playerTop">
<div id="whiteName" class="playerName">WHITE</div>
<div class="dot whiteDot"></div>
</div>
<div id="whiteState" class="playerState">Waiting</div>
</div>

<div id="blackCard" class="player">
<div class="playerTop">
<div id="blackName" class="playerName">BLACK</div>
<div class="dot blackDot"></div>
</div>
<div id="blackState" class="playerState">Waiting</div>
</div>
</div>

<div class="boardWrap">
<div id="board" class="board"></div>
</div>

<div class="info">
<div class="infoBox">
<div class="infoLabel">TURN</div>
<div id="turnValue" class="infoValue">—</div>
</div>

<div class="infoBox">
<div class="infoLabel">MOVE</div>
<div id="moveValue" class="infoValue">1</div>
</div>

<div class="infoBox">
<div class="infoLabel">LAST</div>
<div id="lastValue" class="infoValue">—</div>
</div>
</div>

<div class="controls">
<button id="newBtn" class="button" type="button">NEW GAME</button>
<button id="undoBtn" class="button" type="button">UNDO</button>
</div>

<div id="message" class="message">Choose your side to start.</div>
<div id="history" class="history"></div>
</div>

<div class="footer">LEGAL CHESS · CASTLING · EN PASSANT · PROMOTION · CHECKMATE</div>

<div id="startOverlay" class="startOverlay">
<div class="startPanel">
<div class="startIcon">♔</div>
<div class="startEyebrow">ManzzyID GAME CENTER</div>
<div class="startTitle">VARESA CHESS</div>
<div class="startSub">Choose your side before starting the match.</div>

<div class="sideGrid">
<button id="playWhiteBtn" class="sideBtn" type="button">
<div class="sidePiece whitePiece">♔</div>
<div class="sideName">PLAY WHITE</div>
<div class="sideHint">YOU MOVE FIRST</div>
</button>

<button id="playBlackBtn" class="sideBtn" type="button">
<div class="sidePiece blackPiece">♚</div>
<div class="sideName">PLAY BLACK</div>
<div class="sideHint">BOT MOVES FIRST</div>
</button>
</div>

<div id="matchSummary" class="matchSummary">Select WHITE or BLACK.</div>

<button id="startBtn" class="startBtn" type="button" disabled>START MATCH</button>
<div class="startNote">Standard chess · Castling · En passant · Promotion · Checkmate</div>
</div>
</div>

</div>
</div>

<script>
(function(){
"use strict";

const boardEl=document.getElementById("board");
const statusEl=document.getElementById("status");
const messageEl=document.getElementById("message");
const historyEl=document.getElementById("history");
const whiteCard=document.getElementById("whiteCard");
const blackCard=document.getElementById("blackCard");
const whiteName=document.getElementById("whiteName");
const blackName=document.getElementById("blackName");
const whiteState=document.getElementById("whiteState");
const blackState=document.getElementById("blackState");
const turnValue=document.getElementById("turnValue");
const moveValue=document.getElementById("moveValue");
const lastValue=document.getElementById("lastValue");
const newBtn=document.getElementById("newBtn");
const undoBtn=document.getElementById("undoBtn");
const startOverlay=document.getElementById("startOverlay");
const playWhiteBtn=document.getElementById("playWhiteBtn");
const playBlackBtn=document.getElementById("playBlackBtn");
const startBtn=document.getElementById("startBtn");
const matchSummary=document.getElementById("matchSummary");
const subTitle=document.getElementById("subTitle");

const glyph={
  w:{ p:"♙", n:"♘", b:"♗", r:"♖", q:"♕", k:"♔" },
  b:{ p:"♟", n:"♞", b:"♝", r:"♜", q:"♛", k:"♚" }
};

const value={ p:100, n:320, b:330, r:500, q:900, k:20000 };
const files="abcdefgh";

let board=[];
let turn="w";
let playerSide="w";
let botSide="b";
let selectedSide=null;
let selected=-1;
let selectedMoves=[];
let history=[];
let moveHistory=[];
let castle={ wk:true, wq:true, bk:true, bq:true };
let ep=-1;
let lastFrom=-1;
let lastTo=-1;
let thinking=false;
let gameOver=false;
let gameStarted=false;
let moveNumber=1;

function newBoard(){
  return [
    "rnbqkbnr".split(""),
    "pppppppp".split(""),
    "........".split(""),
    "........".split(""),
    "........".split(""),
    "........".split(""),
    "PPPPPPPP".split(""),
    "RNBQKBNR".split("")
  ].map(row =>
    row.map(ch => {
      if(ch===".") return null;
      return { c:ch.toLowerCase(), s:ch===ch.toUpperCase()?"w":"b" };
    })
  );
}

function cloneBoard(b){
  return b.map(row => row.map(p => p ? { c:p.c, s:p.s } : null));
}

function getState(){
  return {
    board:cloneBoard(board),
    turn,
    castle:{...castle},
    ep,
    moveNumber
  };
}

function inside(r,c){ return r>=0&&r<8&&c>=0&&c<8; }
function opposite(s){ return s==="w"?"b":"w"; }
function squareIndex(r,c){ return r*8+c; }
function locate(idx){ return { r:Math.floor(idx/8), c:idx%8 }; }

function findKing(b,s){
  for(let r=0;r<8;r++){
    for(let c=0;c<8;c++){
      const p=b[r][c];
      if(p&&p.s===s&&p.c==="k") return [r,c];
    }
  }
  return null;
}

function pseudoMoves(state,r,c,attackOnly){
  const b=state.board;
  const p=b[r][c];
  if(!p) return [];

  const list=[];
  const fr=squareIndex(r,c);

  function add(nr,nc,flags){
    if(!inside(nr,nc)) return;
    const q=b[nr][nc];
    if(!q){
      list.push({ fr, to:squareIndex(nr,nc), flags:flags||{} });
    }else if(q.s!==p.s){
      list.push({ fr, to:squareIndex(nr,nc), flags:{ ...(flags||{}), capture:true } });
    }
  }

  if(p.c==="p"){
    const dir=p.s==="w"?-1:1;
    for(const dc of [-1,1]){
      const nr=r+dir;
      const nc=c+dc;
      if(!inside(nr,nc)) continue;
      if(attackOnly){
        list.push({ fr, to:squareIndex(nr,nc), flags:{attack:true} });
      }else{
        const q=b[nr][nc];
        if(q&&q.s!==p.s){
          list.push({ fr, to:squareIndex(nr,nc), flags:{ capture:true, pawn:true, promo:nr===0||nr===7 } });
        }else if(state.ep===squareIndex(nr,nc)){
          list.push({ fr, to:squareIndex(nr,nc), flags:{ ep:true, capture:true, pawn:true } });
        }
      }
    }
    if(attackOnly) return list;

    const one=r+dir;
    if(inside(one,c)&&!b[one][c]){
      list.push({ fr, to:squareIndex(one,c), flags:{ pawn:true, promo:one===0||one===7 } });
      const start=p.s==="w"?6:1;
      const two=r+dir*2;
      if(r===start&&inside(two,c)&&!b[two][c]){
        list.push({ fr, to:squareIndex(two,c), flags:{ pawn:true, double:true } });
      }
    }
    return list;
  }

  const knight=[[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]];
  const kingDirs=[[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];

  if(p.c==="n"){
    for(const [dr,dc] of knight) add(r+dr, c+dc, {});
    return list;
  }

  if(p.c==="k"){
    for(const [dr,dc] of kingDirs) add(r+dr, c+dc, { king:true });
    if(!attackOnly){
      const row=p.s==="w"?7:0;
      if(r===row&&c===4&&!isCheckState(state,p.s)){
        if(state.castle[p.s+"k"]&&!b[row][5]&&!b[row][6]&&!squareAttacked(state,row,5,opposite(p.s))&&!squareAttacked(state,row,6,opposite(p.s))){
          list.push({ fr, to:squareIndex(row,6), flags:{ castle:"k" } });
        }
        if(state.castle[p.s+"q"]&&!b[row][1]&&!b[row][2]&&!b[row][3]&&!squareAttacked(state,row,3,opposite(p.s))&&!squareAttacked(state,row,2,opposite(p.s))){
          list.push({ fr, to:squareIndex(row,2), flags:{ castle:"q" } });
        }
      }
    }
    return list;
  }

  let dirs=[];
  if(p.c==="b"){ dirs=[[1,1],[1,-1],[-1,1],[-1,-1]]; }
  else if(p.c==="r"){ dirs=[[1,0],[-1,0],[0,1],[0,-1]]; }
  else { dirs=[[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]]; }

  for(const [dr,dc] of dirs){
    let nr=r+dr; let nc=c+dc;
    while(inside(nr,nc)){
      const q=b[nr][nc];
      if(!q){
        list.push({ fr, to:squareIndex(nr,nc), flags:{} });
      }else{
        if(q.s!==p.s) list.push({ fr, to:squareIndex(nr,nc), flags:{ capture:true } });
        break;
      }
      nr+=dr; nc+=dc;
    }
  }
  return list;
}

function squareAttacked(state,r,c,bySide){
  for(let rr=0;rr<8;rr++){
    for(let cc=0;cc<8;cc++){
      const p=state.board[rr][cc];
      if(!p||p.s!==bySide) continue;
      const moves=pseudoMoves(state,rr,cc,true);
      for(const m of moves){
        const t=locate(m.to);
        if(t.r===r&&t.c===c) return true;
      }
    }
  }
  return false;
}

function isCheckState(state,side){
  const king=findKing(state.board,side);
  if(!king) return true;
  return squareAttacked(state,king[0],king[1],opposite(side));
}

function applyMove(state,m,promotion){
  const ns={
    board:cloneBoard(state.board),
    turn:opposite(state.turn),
    castle:{...state.castle},
    ep:-1,
    moveNumber:state.moveNumber
  };
  const fr=locate(m.fr);
  const to=locate(m.to);
  const piece=ns.board[fr.r][fr.c];
  const captured=ns.board[to.r][to.c];
  if(!piece) return ns;

  ns.board[fr.r][fr.c]=null;
  if(m.flags.ep){
    const capturedRow=piece.s==="w"?to.r+1:to.r-1;
    ns.board[capturedRow][to.c]=null;
  }

  const newPiece={ c:piece.c, s:piece.s };
  if(m.flags.promo){ newPiece.c=promotion||"q"; }
  ns.board[to.r][to.c]=newPiece;

  if(m.flags.castle){
    const row=fr.r;
    if(m.flags.castle==="k"){
      ns.board[row][5]=ns.board[row][7];
      ns.board[row][7]=null;
    }else{
      ns.board[row][3]=ns.board[row][0];
      ns.board[row][0]=null;
    }
  }

  if(piece.c==="k"){ ns.castle[piece.s+"k"]=false; ns.castle[piece.s+"q"]=false; }
  if(piece.c==="r"){
    if(fr.r===7&&fr.c===0) ns.castle.wq=false;
    if(fr.r===7&&fr.c===7) ns.castle.wk=false;
    if(fr.r===0&&fr.c===0) ns.castle.bq=false;
    if(fr.r===0&&fr.c===7) ns.castle.bk=false;
  }
  if(captured&&captured.c==="r"){
    if(to.r===7&&to.c===0) ns.castle.wq=false;
    if(to.r===7&&to.c===7) ns.castle.wk=false;
    if(to.r===0&&to.c===0) ns.castle.bq=false;
    if(to.r===0&&to.c===7) ns.castle.bk=false;
  }
  if(piece.c==="p"&&Math.abs(to.r-fr.r)===2){
    ns.ep=((fr.r+to.r)/2)*8+fr.c;
  }
  if(piece.s==="b") ns.moveNumber++;
  return ns;
}

function legalMoves(state,side){
  const all=[];
  for(let r=0;r<8;r++){
    for(let c=0;c<8;c++){
      const p=state.board[r][c];
      if(!p||p.s!==side) continue;
      const pseudo=pseudoMoves(state,r,c,false);
      for(const m of pseudo){
        const ns=applyMove(state,m,"q");
        if(!isCheckState(ns,side)) all.push(m);
      }
    }
  }
  return all;
}

function notation(state,m,promo){
  const from=locate(m.fr);
  const to=locate(m.to);
  const p=state.board[from.r][from.c];
  if(m.flags.castle) return m.flags.castle==="k"?"O-O":"O-O-O";

  let text="";
  if(p.c!=="p") text+=p.c.toUpperCase();
  if(m.flags.capture||m.flags.ep){
    if(p.c==="p") text+=files[from.c];
    text+="x";
  }else{
    text+="-";
  }
  text+=files[to.c]+(8-to.r);
  if(m.flags.promo) text+="="+(promo||"q").toUpperCase();
  return text;
}

function checkGame(state){
  const moves=legalMoves(state,state.turn);
  if(moves.length===0){
    gameOver=true;
    if(isCheckState(state,state.turn)){
      messageEl.textContent=state.turn===playerSide?"CHECKMATE — VARESA BOT WINS":"CHECKMATE — YOU WIN";
    }else{
      messageEl.textContent="STALEMATE — DRAW";
    }
    updateUI();
    return true;
  }
  if(isCheckState(state,state.turn)){
    messageEl.textContent=state.turn===playerSide?"CHECK — YOUR KING IS UNDER ATTACK.":"CHECK — BOT KING IS UNDER ATTACK.";
  }else{
    messageEl.textContent=state.turn===playerSide?"Your turn.":"VARESA BOT is calculating...";
  }
  return false;
}

function addHistory(text){
  moveHistory.push(text);
  historyEl.innerHTML=moveHistory.map((x,i)=>'<div class="historyLine">'+(i+1)+". "+x+"</div>").join("");
  historyEl.scrollTop=historyEl.scrollHeight;
}

function render(){
  boardEl.innerHTML="";
  const current=getState();
  const normalForWhite=playerSide==="w";

  for(let vr=0;vr<8;vr++){
    for(let vc=0;vc<8;vc++){
      let r = normalForWhite ? vr : 7 - vr;
      let c = normalForWhite ? vc : 7 - vc;
      const idx=squareIndex(r,c);
      const cell=document.createElement("div");
      cell.className="square "+((r+c)%2===0?"light":"dark");

      if(idx===selected) cell.classList.add("selected");
      if(idx===lastFrom||idx===lastTo) cell.classList.add("last");
      if(selectedMoves.some(m=>m.to===idx)){
        cell.classList.add(board[r][c]?"captureHint":"moveHint");
      }
      if(board[r][c]&&board[r][c].c==="k"&&isCheckState(current,board[r][c].s)){
        cell.classList.add("check");
      }

      if(board[r][c]){
        const piece=document.createElement("div");
        piece.className="piece "+(board[r][c].s==="w"?"whitePiece":"blackPiece");
        piece.textContent=glyph[board[r][c].s][board[r][c].c];
        cell.appendChild(piece);
      }

      const coord=document.createElement("div");
      coord.className="coord";
      coord.textContent=files[c]+(8-r);
      cell.appendChild(coord);

      cell.addEventListener("click",function(){ clickSquare(r,c); });
      boardEl.appendChild(cell);
    }
  }
}

function updateUI(){
  if(!gameStarted) statusEl.textContent="READY";
  else if(gameOver) statusEl.textContent="GAME OVER";
  else if(thinking) statusEl.textContent="BOT THINKING";
  else if(turn===playerSide) statusEl.textContent="YOUR TURN";
  else statusEl.textContent="BOT TURN";

  turnValue.textContent=gameStarted?(turn==="w"?"WHITE":"BLACK"):"—";
  moveValue.textContent=String(moveNumber);

  whiteCard.classList.toggle("active",gameStarted&&!gameOver&&turn==="w");
  blackCard.classList.toggle("active",gameStarted&&!gameOver&&turn==="b");

  whiteName.textContent=playerSide==="w"?"YOU · WHITE":"VARESA BOT · WHITE";
  blackName.textContent=playerSide==="b"?"YOU · BLACK":"VARESA BOT · BLACK";

  whiteState.textContent=!gameStarted?"Waiting":gameOver?"Finished":turn==="w"?(playerSide==="w"?"Your move":"Calculating..."):"Waiting";
  blackState.textContent=!gameStarted?"Waiting":gameOver?"Finished":turn==="b"?(playerSide==="b"?"Your move":"Calculating..."):"Waiting";

  undoBtn.disabled=!gameStarted||thinking||history.length===0;
}

function selectSide(side){
  if(gameStarted) return;
  selectedSide=side;
  playWhiteBtn.classList.toggle("selected",side==="w");
  playBlackBtn.classList.toggle("selected",side==="b");
  startBtn.disabled=false;
  if(side==="w") matchSummary.textContent="You are WHITE. You make the first move.";
  else matchSummary.textContent="You are BLACK. VARESA BOT will move first.";
}

function startGame(){
  if(gameStarted||!selectedSide) return;
  playerSide=selectedSide;
  botSide=opposite(playerSide);
  gameStarted=true;
  gameOver=false;
  thinking=false;
  selected=-1;
  selectedMoves=[];
  subTitle.textContent=playerSide==="w"?"YOU = WHITE · BOT = BLACK":"YOU = BLACK · BOT = WHITE";
  startOverlay.classList.add("hidden");
  render();
  updateUI();

  if(turn===botSide){
    thinking=true;
    messageEl.textContent="VARESA BOT is making the opening move...";
    updateUI();
    setTimeout(function(){ botMove(); }, 40);
  }else{
    messageEl.textContent="Your turn. Select one of your pieces.";
  }
}

function clickSquare(r,c){
  if(!gameStarted||thinking||gameOver||turn!==playerSide) return;
  const idx=squareIndex(r,c);

  if(selected>=0){
    const move=selectedMoves.find(m=>m.to===idx);
    if(move){ playerMove(move); return; }
  }

  const p=board[r][c];
  if(p&&p.s===playerSide){
    selected=idx;
    selectedMoves=legalMoves(getState(),playerSide).filter(m=>m.fr===idx);
    messageEl.textContent=selectedMoves.length?"Choose a highlighted square.":"This piece has no legal moves.";
    render();
    return;
  }

  selected=-1;
  selectedMoves=[];
  messageEl.textContent="Select one of your pieces.";
  render();
}

function playerMove(m){
  if(!gameStarted||gameOver||thinking||turn!==playerSide) return;
  const state=getState();
  history.push(state);

  let promotion="q";
  if(m.flags.promo){
    const answer=window.prompt("Promote to Q, R, B or N","Q");
    if(answer&&"qrbn".includes(answer.toLowerCase())) promotion=answer.toLowerCase();
  }

  const text=notation(state,m,promotion);
  const ns=applyMove(state,m,promotion);
  board=ns.board; turn=ns.turn; castle=ns.castle; ep=ns.ep; moveNumber=ns.moveNumber;
  lastFrom=m.fr; lastTo=m.to;
  selected=-1; selectedMoves=[];
  lastValue.textContent=text;
  addHistory("YOU  "+text);

  if(checkGame(getState())){ render(); updateUI(); return; }

  thinking=true;
  messageEl.textContent="VARESA BOT is calculating...";
  render();
  updateUI();
  setTimeout(botMove,25);
}

function evaluate(state){
  let score=0;
  for(let r=0;r<8;r++){
    for(let c=0;c<8;c++){
      const p=state.board[r][c];
      if(!p) continue;
      let v=value[p.c];
      if(p.c==="p"){
        const advancement=p.s==="w"?6-r:r-1;
        v+=advancement*6;
      }
      if(p.c==="n"||p.c==="b"){
        if(r>=2&&r<=5&&c>=2&&c<=5) v+=14;
      }
      if(p.s==="w") score+=v;
      else score-=v;
    }
  }
  if(isCheckState(state,"w")) score-=35;
  if(isCheckState(state,"b")) score+=35;
  return score;
}

function orderedMoves(state,moves){
  return moves.map(m=>{
    const to=locate(m.to);
    const target=state.board[to.r][to.c];
    let score=0;
    if(target) score+=1000+value[target.c];
    if(m.flags.promo) score+=9000;
    if(m.flags.castle) score+=100;
    if(m.flags.ep) score+=800;
    return { m, score };
  }).sort((a,b)=>b.score-a.score).map(x=>x.m);
}

function minimax(state,depth,alpha,beta){
  const moves=legalMoves(state,state.turn);
  if(moves.length===0){
    if(isCheckState(state,state.turn)){
      if(state.turn==="w") return -1000000-depth;
      return 1000000+depth;
    }
    return 0;
  }
  if(depth<=0) return evaluate(state);

  const ordered=orderedMoves(state,moves);
  if(state.turn==="w"){
    let best=-Infinity;
    for(const m of ordered){
      const ns=applyMove(state,m,"q");
      const score=minimax(ns,depth-1,alpha,beta);
      if(score>best) best=score;
      if(best>alpha) alpha=best;
      if(beta<=alpha) break;
    }
    return best;
  }
  let best=Infinity;
  for(const m of ordered){
    const ns=applyMove(state,m,"q");
    const score=minimax(ns,depth-1,alpha,beta);
    if(score<best) best=score;
    if(best<beta) beta=best;
    if(beta<=alpha) break;
  }
  return best;
}

function botMove(){
  if(!gameStarted||gameOver||turn!==botSide){ thinking=false; updateUI(); return; }
  const state=getState();
  const moves=orderedMoves(state,legalMoves(state,botSide));
  if(!moves.length){ thinking=false; checkGame(state); render(); updateUI(); return; }

  let bestMove=moves[0];
  let bestScore=botSide==="w"?-Infinity:Infinity;
  const depth=2;

  for(const m of moves){
    const ns=applyMove(state,m,"q");
    const score=minimax(ns,depth-1,-Infinity,Infinity);
    if(botSide==="w"){
      if(score>bestScore){ bestScore=score; bestMove=m; }
    }else{
      if(score<bestScore){ bestScore=score; bestMove=m; }
    }
  }

  history.push(state);
  const ns=applyMove(state,bestMove,"q");
  board=ns.board; turn=ns.turn; castle=ns.castle; ep=ns.ep; moveNumber=ns.moveNumber;
  lastFrom=bestMove.fr; lastTo=bestMove.to;

  const text=notation(state,bestMove,"q");
  lastValue.textContent=text;
  addHistory("BOT  "+text);

  thinking=false;
  const ended=checkGame(getState());
  render(); updateUI();
  if(!ended) messageEl.textContent="Your turn.";
}

function newGame(){
  board=newBoard();
  turn="w";
  selected=-1;
  selectedMoves=[];
  history=[];
  moveHistory=[];
  castle={ wk:true, wq:true, bk:true, bq:true };
  ep=-1;
  lastFrom=-1;
  lastTo=-1;
  moveNumber=1;
  thinking=false;
  gameOver=false;
  gameStarted=false;
  selectedSide=null;
  playerSide="w";
  botSide="b";
  historyEl.innerHTML="";
  messageEl.textContent="Choose your side to start.";
  lastValue.textContent="—";
  playWhiteBtn.classList.remove("selected");
  playBlackBtn.classList.remove("selected");
  startBtn.disabled=true;
  matchSummary.textContent="Select WHITE or BLACK.";
  subTitle.textContent="CHOOSE YOUR SIDE";
  startOverlay.classList.remove("hidden");
  render();
  updateUI();
}

playWhiteBtn.addEventListener("click",function(){ selectSide("w"); });
playBlackBtn.addEventListener("click",function(){ selectSide("b"); });
startBtn.addEventListener("click",function(){ startGame(); });
newBtn.addEventListener("click",function(){ newGame(); });

document.addEventListener("keydown",function(e){
  if(e.key==="Escape"){
    selected=-1; selectedMoves=[];
    messageEl.textContent="Selection cleared.";
    render();
  }
});

newGame();
})();
</script>`;

    const responseId = "ManzzyID-chess-" + Date.now();

    const sentMessage = await sock.relayMessage(
        remoteJid,
        {
            messageContextInfo: {
                deviceListMetadata: {},
                deviceListMetadataVersion: 2,
                messageSecret: "0cCzjnQ5ERoqM2QrQ7KjmMfxsyeWYu+61/chr2wioyE=",
                botMetadata: {
                    messageDisclaimerText: "",
                    botResponseId: responseId
                }
            },
            botForwardedMessage: {
                message: {
                    richResponseMessage: {
                        messageType: 1,
                        submessages: [
                            {
                                messageType: 2,
                                messageText: "ManzzyID • VARESA CHESS"
                            }
                        ],
                        unifiedResponse: {
                            data: Buffer.from(
                                JSON.stringify({
                                    response_id: responseId,
                                    sections: [
                                        {
                                            view_model: {
                                                primitive: {
                                                    __typename: "GenAIaeacdsnwHtmlPrimitive",
                                                    payload: html,
                                                    trusted_sources: ["manzzy.web.id"]
                                                },
                                                __typename: "GenAISingleLayoutViewModel"
                                            }
                                        }
                                    ]
                                })
                            ).toString("base64")
                        },
                        contextInfo: {
                            mentionedJid: [],
                            groupMentions: [],
                            statusAttributions: [],
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardedAiBotMessageInfo: {
                                botJid: "867051314767696@bot"
                            },
                            forwardOrigin: 4
                        }
                    }
                }
            }
        },
        { messageId: responseId }
    );

    // Auto-delete setelah 3 menit (180,000 milidetik)
    setTimeout(async () => {
        try {
            await sock.sendMessage(remoteJid, {
                delete: {
                    remoteJid: remoteJid,
                    fromMe: true,
                    id: responseId
                }
            });
        } catch (e) {
            // Gagal hapus diabaikan (misal sudah terhapus manual)
        }
    }, 3 * 60 * 1000);
}

export default {
  handle,
  Commands: ["catur", "chess", "gamecatur", "playchess", "chessgame"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 0,
};