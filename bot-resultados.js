#!/usr/bin/env node
'use strict';

/* ============================================================
   TREM DO HEXA — Bot de resultados oficiais
   ------------------------------------------------------------
   Lê os jogos já terminados de uma fonte oficial e grava os
   placares no MESMO documento que o admin usa (config/resultados),
   atualizando a classificação dos grupos. Assim o ranking da galera
   se atualiza sozinho.

   NÃO mexe no seu admin: o admin continua abrindo, mostrando os
   resultados (inclusive os que o bot colocou) e deixando você
   editar manualmente quando quiser. O bot, por padrão, só preenche
   jogos que AINDA NÃO têm placar — ou seja, respeita o que você
   colocou na mão.

   Rodar:  node bot-resultados.js
   Requer: Node 18+  e  `npm install`  (instala o firebase)

   Fonte dos resultados (variável de ambiente FONTE):
     FONTE=football-data  -> football-data.org (precisa de chave grátis)
                             defina FOOTBALL_DATA_TOKEN=suachave
     FONTE=openfootball    -> github.com/openfootball (sem chave; atualiza ~1x/dia)
     FONTE=manual          -> lê o arquivo resultados-manuais.json

   Sobrescrever jogos já preenchidos? (padrão: não)
     SOBRESCREVER=1   -> o bot regrava mesmo jogos já finalizados
   ============================================================ */

/* ===== Config do Firebase (a mesma do site, é pública) ===== */
var firebaseConfig = {
  apiKey: "AIzaSyC7aasf0H6BnrVOQ_8dqqdXl05_OV96yls",
  authDomain: "bolao-da-copa2026.firebaseapp.com",
  projectId: "bolao-da-copa2026",
  storageBucket: "bolao-da-copa2026.firebasestorage.app",
  messagingSenderId: "120832372036",
  appId: "1:120832372036:web:c8b7ec37983b535ab5fb11"
};

/* ===== Lê o arquivo config.txt (se existir) — assim você NÃO precisa mexer
   com variáveis de ambiente: basta editar config.txt e rodar.
   Formato: uma linha por opção, no estilo  CHAVE=valor.
   (Se você usar variável de ambiente, ela tem prioridade sobre o arquivo.) */
function lerConfig() {
  try {
    var fs = require('fs');
    var path = require('path');
    var arquivo = path.join(__dirname, 'config.txt');
    if (!fs.existsSync(arquivo)) return {};
    var conf = {};
    fs.readFileSync(arquivo, 'utf-8').split(/\r?\n/).forEach(function (linha) {
      linha = linha.trim();
      if (!linha || linha[0] === '#') return;          // ignora linhas vazias e comentários
      var i = linha.indexOf('=');
      if (i < 0) return;
      conf[linha.slice(0, i).trim()] = linha.slice(i + 1).trim();
    });
    return conf;
  } catch (e) { return {}; }
}
var CONFIG = lerConfig();

var FONTE = (process.env.FONTE || CONFIG.FONTE || 'football-data').toLowerCase();
var FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN || CONFIG.FOOTBALL_DATA_TOKEN || '';
var SOBRESCREVER = (process.env.SOBRESCREVER || CONFIG.SOBRESCREVER) === '1';

/* ===== Grupos na MESMA ordem do app + apelidos p/ casar nomes da fonte =====
   1º item de cada time = nome no app; os demais são apelidos aceitos
   (inglês e variações). A comparação ignora acentos, maiúsculas e
   pontuação, então "Bosnia & Herzegovina", "Bosnia and Herzegovina" e
   "Bósnia e Herzegovina" todos casam. */
var GROUPS = {
  A: [['México','Mexico'],['África do Sul','South Africa'],['Coreia do Sul','South Korea','Korea Republic'],['República Tcheca','Czech Republic','Czechia']],
  B: [['Canadá','Canada'],['Catar','Qatar'],['Suíça','Switzerland'],['Bósnia e Herzegovina','Bosnia & Herzegovina','Bosnia and Herzegovina','Bosnia-Herzegovina','Bosnia']],
  C: [['Brasil','Brazil'],['Marrocos','Morocco'],['Haiti'],['Escócia','Scotland']],
  D: [['EUA','USA','United States','United States of America'],['Paraguai','Paraguay'],['Austrália','Australia'],['Turquia','Turkey','Türkiye','Turkiye']],
  E: [['Alemanha','Germany'],['Curaçao','Curacao'],['Costa do Marfim','Ivory Coast','Côte d\'Ivoire','Cote d\'Ivoire'],['Equador','Ecuador']],
  F: [['Holanda','Netherlands','Holland'],['Japão','Japan'],['Tunísia','Tunisia'],['Suécia','Sweden']],
  G: [['Bélgica','Belgium'],['Egito','Egypt'],['Irã','Iran','IR Iran'],['Nova Zelândia','New Zealand']],
  H: [['Espanha','Spain'],['Cabo Verde','Cape Verde'],['Arábia Saudita','Saudi Arabia'],['Uruguai','Uruguay']],
  I: [['França','France'],['Senegal'],['Noruega','Norway'],['Iraque','Iraq']],
  J: [['Argentina'],['Argélia','Algeria'],['Áustria','Austria'],['Jordânia','Jordan']],
  K: [['Portugal'],['Uzbequistão','Uzbekistan'],['Colômbia','Colombia'],['RD Congo','DR Congo','Congo DR','Democratic Republic of the Congo','Congo']],
  L: [['Inglaterra','England'],['Croácia','Croatia'],['Gana','Ghana'],['Panamá','Panama']]
};
var LETTERS = Object.keys(GROUPS);
// Mesma matriz de confrontos do app: slot -> [idxMandante, idxVisitante]
var MATCH_PAIRS = [[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]];

/* ============================================================
   LÓGICA PURA (testável, sem rede)
   ============================================================ */

// normaliza nome: minúsculas, sem acentos, só letras/números
function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

// monta índice: nomeNormalizado -> { grupo, idx, nomeApp }
function buildIndex() {
  var index = {};
  LETTERS.forEach(function (L) {
    GROUPS[L].forEach(function (aliases, idx) {
      aliases.forEach(function (name) {
        index[norm(name)] = { grupo: L, idx: idx, nomeApp: aliases[0] };
      });
    });
  });
  return index;
}

// mapeia um jogo oficial -> { key:'X-i', grupo, slot, c, f } ou { error }
// c = gols de teams[pair[0]], f = gols de teams[pair[1]]  (convenção do app)
function mapGame(home, away, hg, ag, index) {
  var h = index[norm(home)], a = index[norm(away)];
  if (!h && !a) return { error: 'times não reconhecidos: "' + home + '" e "' + away + '"' };
  if (!h) return { error: 'time não reconhecido: "' + home + '"' };
  if (!a) return { error: 'time não reconhecido: "' + away + '"' };
  if (h.grupo !== a.grupo) return { error: 'times de grupos diferentes (' + h.nomeApp + '/' + a.nomeApp + ')' };
  var hi = h.idx, ai = a.idx, slot = -1;
  for (var s = 0; s < 6; s++) {
    var p = MATCH_PAIRS[s];
    if ((p[0] === hi && p[1] === ai) || (p[0] === ai && p[1] === hi)) { slot = s; break; }
  }
  if (slot < 0) return { error: 'confronto inexistente no grupo' };
  var pair = MATCH_PAIRS[slot];
  var c = (pair[0] === hi) ? hg : ag;
  var f = (pair[0] === hi) ? ag : hg;
  return { key: h.grupo + '-' + slot, grupo: h.grupo, slot: slot, c: parseInt(c, 10), f: parseInt(f, 10) };
}

// classificação de um grupo a partir dos resultados — MESMA lógica do app
// (pts -> saldo -> gols pró -> nome). Só retorna se o grupo estiver completo.
function calcStandings(letter, grupos) {
  var teams = GROUPS[letter].map(function (t) { return t[0]; });
  var rows = teams.map(function (n) { return { name: n, gf: 0, ga: 0, gd: 0, pts: 0 }; });
  var count = 0;
  MATCH_PAIRS.forEach(function (pair, i) {
    var g = grupos[letter + '-' + i];
    if (!g || g.status !== 'finished') return;
    var c = parseInt(g.c, 10), f = parseInt(g.f, 10);
    if (isNaN(c) || isNaN(f)) return;
    count++;
    var hi = pair[0], ai = pair[1];
    rows[hi].gf += c; rows[hi].ga += f;
    rows[ai].gf += f; rows[ai].ga += c;
    if (c > f) rows[hi].pts += 3;
    else if (f > c) rows[ai].pts += 3;
    else { rows[hi].pts++; rows[ai].pts++; }
  });
  if (count < 6) return null; // grupo incompleto: não classifica (igual ao app)
  rows.forEach(function (r) { r.gd = r.gf - r.ga; });
  rows.sort(function (a, b) {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.gd !== a.gd) return b.gd - a.gd;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.name.localeCompare(b.name, 'pt');
  });
  return rows.map(function (r) { return r.name; });
}

// funde os jogos novos no doc atual, preservando tudo o que o bot não gerencia
function mergeResults(current, jogos, opts) {
  opts = opts || {};
  var index = opts.index || buildIndex();
  var res = Object.assign(
    { campeao: '', vice: '', artilheiro: '', gols: '', grupos: {}, classificacoes: {}, knockout: {}, datas: {} },
    current || {}
  );
  res.grupos = Object.assign({}, res.grupos);
  res.classificacoes = Object.assign({}, res.classificacoes);
  res.knockout = Object.assign({}, res.knockout);

  var added = [], skipped = [], errors = [];
  jogos.forEach(function (j) {
    if (j.hg == null || j.ag == null || isNaN(parseInt(j.hg, 10)) || isNaN(parseInt(j.ag, 10))) return;
    var m = mapGame(j.home, j.away, j.hg, j.ag, index);
    if (m.error) { errors.push(j.home + ' x ' + j.away + ' — ' + m.error); return; }
    var ex = res.grupos[m.key];
    if (ex && ex.status === 'finished' && !opts.sobrescrever) {
      if (parseInt(ex.c, 10) !== m.c || parseInt(ex.f, 10) !== m.f) {
        skipped.push(m.key + ' (já tinha ' + ex.c + 'x' + ex.f + ', mantido; fonte diz ' + m.c + 'x' + m.f + ')');
      }
      return;
    }
    if (ex && ex.status === 'finished' && ex.c === m.c && ex.f === m.f) return; // idêntico, nada a fazer
    res.grupos[m.key] = { c: m.c, f: m.f, status: 'finished' };
    added.push(j.home + ' ' + j.hg + ' x ' + j.ag + ' ' + j.away + '  [' + m.key + ']');
  });

  // recomputa a classificação dos grupos que ficaram completos
  LETTERS.forEach(function (L) {
    var st = calcStandings(L, res.grupos);
    if (st) res.classificacoes[L] = st;
  });

  // DATAS dos jogos (pra destacar "os jogos do dia" no site).
  // Vêm da "agenda" da fonte; cada jogo é mapeado ao seu slot (X-i).
  res.datas = Object.assign({}, res.datas);
  (opts.agenda || []).forEach(function (g) {
    if (!g || !g.date) return;
    var m = mapGame(g.home, g.away, 0, 0, index);
    if (m.error) return; // jogo de mata-mata ou nome não reconhecido -> ignora em silêncio
    res.datas[m.key] = g.date;
  });
  var datasChanged = JSON.stringify(res.datas) !== JSON.stringify((current || {}).datas || {});

  res.ultimaAtualizacao = opts.now || new Date().toLocaleString('pt-BR');
  return { res: res, added: added, skipped: skipped, errors: errors, datasChanged: datasChanged };
}

/* ============================================================
   FONTES DE RESULTADOS (adaptadores) — todas retornam
   uma lista de { home, away, hg, ag } de jogos JÁ terminados.
   ============================================================ */

// football-data.org (precisa de chave grátis em football-data.org/client/register)
async function fetchFootballData() {
  if (!FOOTBALL_DATA_TOKEN || /COLE_SEU_TOKEN/i.test(FOOTBALL_DATA_TOKEN)) {
    throw new Error('Falta o token do football-data.org. Abra o arquivo config.txt e cole o seu token na linha FOOTBALL_DATA_TOKEN= (a chave grátis vem por e-mail; também aparece em football-data.org, na sua conta).');
  }
  // Busca TODOS os jogos (não só os terminados) pra ter também a DATA de cada partida.
  var r = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
    headers: { 'X-Auth-Token': FOOTBALL_DATA_TOKEN }
  });
  if (!r.ok) throw new Error('football-data.org respondeu HTTP ' + r.status);
  var data = await r.json();
  var matches = data.matches || [];
  var jogos = matches
    .filter(function (m) {
      return m.status === 'FINISHED' && m.score && m.score.fullTime && m.score.fullTime.home != null;
    })
    .map(function (m) {
      return { home: m.homeTeam.name, away: m.awayTeam.name, hg: m.score.fullTime.home, ag: m.score.fullTime.away };
    });
  // Agenda: jogos de FASE DE GRUPOS com a data/hora oficial (utcDate, ISO).
  // Identifica jogo de grupo pela marcação oficial "group" (ex.: GROUP_A); cai pro "stage" como reforço.
  // O mapGame ainda valida que os dois times são do MESMO grupo do app, então mata-mata é descartado.
  var agenda = matches
    .filter(function (m) {
      return (m.group != null || m.stage === 'GROUP_STAGE')
        && m.homeTeam && m.awayTeam && m.homeTeam.name && m.awayTeam.name && m.utcDate;
    })
    .map(function (m) {
      return { home: m.homeTeam.name, away: m.awayTeam.name, date: m.utcDate };
    });
  return { jogos: jogos, agenda: agenda };
}

// openfootball (sem chave; dados públicos no GitHub, atualizam ~1x/dia)
async function fetchOpenFootball() {
  var url = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';
  var r = await fetch(url);
  if (!r.ok) throw new Error('openfootball respondeu HTTP ' + r.status);
  var data = await r.json();
  var grupos = (data.matches || []).filter(function (m) { return m.group && /^Group/i.test(m.group); });
  var jogos = grupos
    .filter(function (m) { return m.score && m.score.ft && m.score.ft.length === 2; })
    .map(function (m) { return { home: m.team1, away: m.team2, hg: m.score.ft[0], ag: m.score.ft[1] }; });
  // Agenda: data de cada jogo de grupo (openfootball traz a data no formato AAAA-MM-DD).
  var agenda = grupos
    .filter(function (m) { return m.date; })
    .map(function (m) { return { home: m.team1, away: m.team2, date: m.date }; });
  return { jogos: jogos, agenda: agenda };
}

// manual: lê resultados-manuais.json no formato [{home, away, hg, ag, date?}, ...]
async function fetchManual() {
  var fs = require('fs');
  var path = require('path');
  var file = path.join(__dirname, 'resultados-manuais.json');
  if (!fs.existsSync(file)) {
    throw new Error('Arquivo resultados-manuais.json não encontrado. Crie-o com [{"home","away","hg","ag"}, ...].');
  }
  var arr = JSON.parse(fs.readFileSync(file, 'utf-8'));
  var agenda = (arr || [])
    .filter(function (g) { return g && g.date; })
    .map(function (g) { return { home: g.home, away: g.away, date: g.date }; });
  return { jogos: arr, agenda: agenda };
}

async function fetchResults() {
  if (FONTE === 'football-data') return fetchFootballData();
  if (FONTE === 'openfootball') return fetchOpenFootball();
  if (FONTE === 'manual') return fetchManual();
  throw new Error('FONTE desconhecida: "' + FONTE + '" (use football-data, openfootball ou manual).');
}

/* ============================================================
   MAIN — lê o doc atual, funde, grava de volta (Firestore)
   ============================================================ */
async function main() {
  var fbApp = require('firebase/app');
  var fs = require('firebase/firestore');

  var app = fbApp.initializeApp(firebaseConfig);
  // long polling: necessário pro Firestore funcionar dentro do Node
  var db = fs.initializeFirestore(app, { experimentalForceLongPolling: true });
  var ref = fs.doc(db, 'config', 'resultados');

  console.log('🤖 Trem do Hexa — bot de resultados');
  console.log('   Fonte: ' + FONTE + (SOBRESCREVER ? '  (sobrescrevendo)' : '  (preserva o que já existe)'));

  console.log('→ buscando jogos e agenda...');
  var fonte = await fetchResults();
  var jogos = fonte.jogos || [];
  var agenda = fonte.agenda || [];
  console.log('   ' + jogos.length + ' jogo(s) terminado(s) e ' + agenda.length + ' jogo(s) na agenda (com data).');

  console.log('→ lendo resultados atuais do Firestore...');
  var snap = await fs.getDoc(ref);
  var current = snap.exists() ? snap.data() : {};

  var out = mergeResults(current, jogos, { index: buildIndex(), sobrescrever: SOBRESCREVER, agenda: agenda });

  if (out.errors.length) {
    console.log('\n⚠️  ' + out.errors.length + ' jogo(s) não mapeado(s) (provável diferença de nome — ignorados):');
    out.errors.forEach(function (e) { console.log('     - ' + e); });
  }
  if (out.skipped.length) {
    console.log('\n• ' + out.skipped.length + ' jogo(s) já preenchido(s), mantido(s) (use SOBRESCREVER=1 pra forçar):');
    out.skipped.forEach(function (s) { console.log('     - ' + s); });
  }

  var nDatas = Object.keys(out.res.datas || {}).length;
  if (out.added.length === 0 && !out.datasChanged) {
    console.log('\n✅ Nada novo pra gravar. Tudo já está atualizado. (' + nDatas + ' jogo(s) com data salva.)');
    process.exit(0);
  }

  if (out.added.length) {
    console.log('\n📝 ' + out.added.length + ' jogo(s) novo(s):');
    out.added.forEach(function (a) { console.log('     + ' + a); });
  }
  if (out.datasChanged) {
    console.log('\n🗓️  datas dos jogos atualizadas (' + nDatas + ' jogo(s) com data).');
  }

  console.log('\n→ gravando no Firestore (config/resultados)...');
  await fs.setDoc(ref, out.res); // grava o doc completo, igual ao admin
  console.log('✅ Pronto! O ranking da galera já reflete os novos resultados.');
  process.exit(0);
}

/* exporta a lógica pura pra testes; só roda o main se chamado direto */
module.exports = { norm: norm, buildIndex: buildIndex, mapGame: mapGame, calcStandings: calcStandings, mergeResults: mergeResults, lerConfig: lerConfig, GROUPS: GROUPS, MATCH_PAIRS: MATCH_PAIRS };

if (require.main === module) {
  main().catch(function (e) {
    console.error('\n❌ Erro:', e.message);
    process.exit(1);
  });
}
