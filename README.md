# 🤖 Bot de resultados — Trem do Hexa

Coloca os **placares oficiais dos jogos** direto no bolão (no mesmo lugar que o admin grava: `config/resultados` no Firestore) e atualiza a **classificação de cada grupo**. Assim o **ranking da galera se atualiza sozinho**, sem você digitar jogo por jogo.

O bot **não mexe no seu admin**. Você continua abrindo o admin normalmente, vê os resultados que o bot colocou e pode editar na mão quando quiser. Por padrão, o bot **só preenche jogos que ainda não têm placar** — ou seja, ele respeita o que você ajustou manualmente.

---

## O que você precisa

- **Node.js 18 ou mais novo** (o bot usa `fetch` nativo). Veja em https://nodejs.org
- Os arquivos desta pasta.

Instale as dependências uma vez:

```bash
npm install
```

---

## Escolha a fonte dos resultados

O bot aceita 3 fontes (variável de ambiente `FONTE`):

| FONTE | Precisa de chave? | Quão fresco | Observação |
|---|---|---|---|
| `football-data` | Sim (grátis) | Ao vivo | **Recomendado.** Resultados oficiais, atualizados durante os jogos. |
| `openfootball` | Não | ~1x por dia | Sem cadastro. Dados públicos no GitHub; pode demorar a sair. |
| `manual` | Não | Você que põe | Lê o arquivo `resultados-manuais.json`. Útil pra testar. |

### Opção A — football-data.org (recomendada)

1. Crie uma conta grátis em **https://www.football-data.org/client/register**
2. Você recebe um **token** (uma sequência de letras/números) por e-mail.
3. Rode assim (Linux/Mac):

```bash
FONTE=football-data FOOTBALL_DATA_TOKEN=seu_token_aqui node bot-resultados.js
```

No Windows (PowerShell):

```powershell
$env:FONTE="football-data"; $env:FOOTBALL_DATA_TOKEN="seu_token_aqui"; node bot-resultados.js
```

### Opção B — openfootball (sem chave)

```bash
FONTE=openfootball node bot-resultados.js
```

### Opção C — manual (pra testar)

Crie um arquivo `resultados-manuais.json` (veja o exemplo `resultados-manuais.example.json`) com a lista de jogos terminados e rode:

```bash
FONTE=manual node bot-resultados.js
```

Os nomes dos times podem estar em **português** (igual ao app) ou **inglês** — o bot reconhece os dois.

---

## Mata-mata (16 avos até a final) — automático

Quando a fase de grupos termina, o bot passa a pegar também os resultados do **mata-mata inteiro**: 16 avos, oitavas, quartas, semifinais, final e disputa de 3º lugar. Ele grava em `res.knockout` — o mesmo lugar que o app lê pra montar o chaveamento da galera, do resumo e da Etapa 3.

**Como ele acha o confronto certo:** o bot reconstrói o chaveamento a partir da classificação dos grupos + dos resultados que já gravou, e descobre a rodada e o jogo de cada partida **pelos dois times**. Por isso funciona rodada a rodada — cada rodada só "abre" quando a anterior fecha (aí ele já sabe quem passou). Não importa qual seleção a fonte põe como mandante: o placar entra na ordem certa do app.

**Pênaltis:** o placar gravado em `c`/`f` é sempre o do **fim da prorrogação** (o empate, quando o jogo é decidido nos pênaltis). O resultado do shootout vai pra `pc`/`pf` e serve **só pra saber quem avançou** no chaveamento — ele **não conta pontos**. A pontuação considera apenas os gols do tempo normal + prorrogação.
- No `football-data` ele desconta os pênaltis sozinho. (Atenção técnica: o `fullTime` da API soma os gols do shootout no placar — ex.: 1-1 + pên 6-5 vira `fullTime` 7-6 — então o bot usa `regularTime + extraTime`, que é o placar real do fim da prorrogação.) Se a fonte informar só o vencedor (sem o placar das penalidades), o bot grava um `1 x 0` simbólico em `pc`/`pf` só pra o chaveamento avançar.
- No `openfootball` ele usa o placar `et` (fim da prorrogação) quando há, senão o `ft` (90 min); os pênaltis ficam em `p`.
- No **manual**, basta pôr `"ph"` e `"pa"` no jogo. Ex.: `{ "home": "Brasil", "away": "Japão", "hg": 1, "ag": 1, "ph": 4, "pa": 2 }` (hg/ag = empate da prorrogação; ph/pa = pênaltis).

**Datas:** o bot também grava a data dos jogos do mata-mata (assim que os dois times do confronto são conhecidos). Isso faz a aba **Palpite da Galera** revelar o palpite dos outros sozinha quando a rodada começa.

> Pra mata-mata sempre certo (inclusive pênaltis), prefira `football-data` (com token) ou `manual`. O `openfootball` funciona, mas pode demorar e nem sempre traz o placar dos pênaltis.

---

## Deixar 100% automático (opcional)

### Jeito 1 — cron na sua máquina/servidor

Roda o bot de tempos em tempos enquanto a máquina estiver ligada. Exemplo (a cada 20 min) no `crontab -e`:

```
*/20 * * * * cd /caminho/para/bolao-bot && FONTE=football-data FOOTBALL_DATA_TOKEN=seu_token node bot-resultados.js >> bot.log 2>&1
```

### Jeito 2 — GitHub Actions (na nuvem, de graça)

Já incluí o arquivo `.github/workflows/atualizar-resultados.yml`. Passo a passo:

1. Suba esta pasta para um repositório no GitHub.
2. No repositório: **Settings › Secrets and variables › Actions › New repository secret**
   - Nome: `FOOTBALL_DATA_TOKEN` — Valor: seu token.
   - (Se preferir `openfootball`, não precisa de segredo; troque `FONTE` para `openfootball` no arquivo do workflow.)
3. Pronto. Ele roda sozinho a cada ~20 min e você também pode disparar na mão em **Actions › Atualizar resultados do bolão › Run workflow**.

---

## Como o bot decide o placar de cada jogo

- Ele casa os nomes das seleções (ignorando acentos/maiúsculas) com os grupos do app.
- Grava o placar na **mesma posição (slot) e convenção (c/f)** que o app usa, então **não importa qual time a fonte coloca como mandante** — o resultado entra certo e a pontuação bate.
- Quando os 6 jogos de um grupo terminam, ele calcula a **classificação** com a mesma regra do app (pontos → saldo → gols pró → nome).
- Campeão, vice, artilheiro e total de gols (Etapa 1) **continuam sendo seus, no admin** — o bot não toca neles.

---

## Perguntas rápidas

**O bot apaga o que eu coloquei na mão?** Não. Ele só preenche jogos sem placar. Se quiser que ele force/atualize tudo, rode com `SOBRESCREVER=1`.

**Posso usar o admin junto com o bot?** Sim. Eles gravam no mesmo lugar; o admin mostra o que o bot colocou e deixa você ajustar.

**Os nomes têm que estar perfeitos?** Não. O bot já entende as variações comuns (Bósnia/Bosnia, EUA/USA, Costa do Marfim/Ivory Coast, etc.). Se algum nome não casar, o bot avisa no log e ignora só aquele jogo.
