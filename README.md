# Rastreio do produto físico

Parte das campanhas depende de um produto físico na mão do criador, e o prazo do conteúdo só começa quando o pacote chega. Este serviço cadastra o código de rastreio em um agregador (fictício, no estilo dos serviços de rastreio), consulta os eventos e traduz o dialeto de cada transportadora para cinco status estáveis. Também avisa quando o tempo em trânsito passa de um limite configurável.

O agregador pode mandar eventos repetidos e fora de ordem. Evento antigo que chega depois não faz o status voltar, e consultar de novo não duplica o histórico.

## Como rodar

Requer Node 22.13 ou mais novo (usa `node:sqlite`).

```bash
npm install
npm test
npm run typecheck
```

Para testar à mão, suba o agregador fictício e o serviço em dois terminais:

```bash
npm run mock-aggregator   # http://127.0.0.1:3005
npm run dev               # http://127.0.0.1:3004
```

Com o serviço no ar, a documentação interativa fica em **http://127.0.0.1:3004/docs** (Scalar). Ela lista todos os endpoints com campos, exemplos e erros, e permite mandar requisições pelo navegador; os exemplos do cadastro já trazem os quatro cenários abaixo. A especificação OpenAPI 3.1 fica em `/openapi.json`, e `test/openapi.test.ts` falha se ela divergir das rotas ou das respostas reais.

Pelo terminal:

```bash
curl -s -X POST localhost:3004/v1/shipments \
  -H 'content-type: application/json' \
  -d '{"tracking_code":"QB000000002BR","carrier":"correios","reference":"campanha-42/criador-7"}'

curl -s localhost:3004/v1/shipments/<id>
curl -s localhost:3004/v1/alerts
```

O agregador fictício traz quatro cenários, escolhidos pelo código (`mock-aggregator/scenarios.ts`):

| Código | Cenário |
| --- | --- |
| `QB000000001BR` | Entrega normal, dentro do prazo |
| `QB000000002BR` | Evento repetido, fora de ordem e com um status inventado |
| `QB000000003BR` | Parado em trânsito há semanas: gera aviso de atraso |
| `QB000000004BR` | Devolvido: o texto diz "entregue", mas é ao remetente |

As datas dos cenários são fixas (setembro e outubro de 2026). Com o relógio do sistema, o atraso depende de quando você roda.

### Configuração

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `3004` | Porta da API |
| `DB_PATH` | `data/rastreio.sqlite` | Banco SQLite |
| `AGGREGATOR_URL` | `http://127.0.0.1:3005` | URL do agregador |
| `AGGREGATOR_TIMEOUT_MS` | `5000` | Timeout de cada chamada ao agregador |
| `TRANSIT_LIMIT_DAYS` | `7` | Limite padrão de trânsito, em dias corridos |
| `DELAY_CHECK_INTERVAL_MS` | `900000` | Intervalo do monitor de atraso |

## Contrato da API

| Rota | Faz |
| --- | --- |
| `GET /health` | Saúde |
| `POST /v1/shipments` | Cadastra no agregador e grava. Devolve 201; o mesmo código e transportadora devolvem a encomenda existente com 200 |
| `GET /v1/shipments/:id` | Sincroniza com o agregador, grava só eventos novos e devolve o estado |
| `GET /v1/alerts` | Avisos de atraso, abertos e desfeitos |
| `GET /docs` | Documentação interativa (Scalar) |
| `GET /openapi.json` | Especificação OpenAPI 3.1 |

Corpo do cadastro:

```json
{ "tracking_code": "QB123456789BR", "carrier": "correios", "transit_limit_days": 5, "reference": "campanha-42/criador-7" }
```

- `tracking_code`: de 8 a 40 letras ou números. É guardado em maiúsculas.
- `carrier`: `correios`, `jadlog` ou `loggi`.
- `transit_limit_days` (opcional): inteiro de 1 a 90 dias. Sem ele, vale `TRANSIT_LIMIT_DAYS`.
- `reference` (opcional): texto livre para ligar a encomenda à campanha.
- Campos extras são recusados.

Erros saem como `{ "error": { "code", "message", "field"? } }`:

| HTTP | Quando |
| --- | --- |
| 400 | JSON malformado ou campo inválido; `field` diz qual |
| 404 | Encomenda inexistente |
| 413 | Corpo acima de 16 KiB |
| 422 | Transportadora não suportada |
| 502 | Agregador falhou no cadastro; nada é gravado |

Se o agregador falhar na consulta, a resposta continua 200 com o estado guardado, `stale: true` e `sync_error` (`indisponivel`, `nao_encontrado` ou `resposta_invalida`). A falha não apaga o que já se sabe.

## Os cinco status

`postado`, `em_transito`, `saiu_para_entrega`, `entregue` e `excecao`.

Antes de qualquer evento reconhecido, `status` é `null` e `status_reason` explica o motivo. Não existe um sexto status.

A tradução fica no adaptador do agregador (`src/providers/rastreio-fake/status-map.ts`) e usa o **código exato** da transportadora, ignorando só caixa, acentos e espaços repetidos:

| Status | Correios | Jadlog | Loggi |
| --- | --- | --- | --- |
| `postado` | `PO` | `EMISSAO` | `picked_up` |
| `em_transito` | `RO`, `DO` | `TRANSFERENCIA` | `in_transit` |
| `saiu_para_entrega` | `OEC` | `EM ROTA` | `out_for_delivery` |
| `entregue` | `BDE` | `ENTREGUE` | `delivered` |
| `excecao` | `BDI-ausente`, `BDE-remetente`, `FC-extravio` | `INSUCESSO`, `DEVOLVIDO` | `delivery_failed`, `returned_to_sender` |

Os dialetos são fictícios, inspirados no estilo de cada transportadora.

### Prazo na resposta

O bloco `delay` traz o prazo em dias:

- `limit_days`: o limite aplicado;
- `elapsed_days`: o tempo em trânsito, com uma casa decimal;
- `late_since`: o instante em UTC em que o limite passou;
- `summary`: uma frase pronta para mostrar a quem acompanha a campanha, com datas no horário de Brasília. Exemplos:
  - "Postado há 2 dias e 1 h; o limite é de 7 dias."
  - "Postado há 10 dias e 23 h e ainda sem entrega; passou do limite de 7 dias em 08/10/2026 às 10:02."
  - "Entregue em 2 dias e 4 h, dentro do limite de 7 dias."
  - "Ainda sem postagem reconhecida; a contagem do prazo de 7 dias não começou."

## Exemplo: payload bruto → status normalizado

O bloco abaixo é gerado por `npm run example -- --write-readme`, que passa o cenário `QB000000002BR` pelo caminho real (cliente HTTP → serviço). Um teste falha se o bloco divergir da saída atual.

No payload há um `RO` repetido (com outro `checkpoint_id`), eventos fora de ordem e um código que a transportadora inventou (`RX9`, com o texto "aguardando confirmação de entrega"). Na resposta, o histórico tem cinco eventos em ordem cronológica, o status é `saiu_para_entrega` e o `RX9` aparece com `status: null`, sem virar entrega.

<!-- exemplo:inicio -->
Payload bruto do agregador (`GET /trackings/correios/QB000000002BR`):

```json
{
  "data": {
    "tracking_number": "QB000000002BR",
    "courier_code": "correios",
    "checkpoints": [
      {
        "checkpoint_id": "cp_0001",
        "checkpoint_time": "2026-10-02 08:40:00",
        "checkpoint_tz": "-03:00",
        "courier_status": "RO",
        "message": "Objeto em trânsito - por favor aguarde",
        "location": "CTE Cajamar - SP"
      },
      {
        "checkpoint_id": "cp_0002",
        "checkpoint_time": "2026-10-01 10:02:00",
        "checkpoint_tz": "-03:00",
        "courier_status": "PO",
        "message": "Objeto postado",
        "location": "AGF Pinheiros - SP"
      },
      {
        "checkpoint_id": "cp_0003",
        "checkpoint_time": "2026-10-02 08:40:00",
        "checkpoint_tz": "-03:00",
        "courier_status": "RO",
        "message": "Objeto em trânsito - por favor aguarde",
        "location": "CTE Cajamar - SP"
      },
      {
        "checkpoint_id": "cp_0004",
        "checkpoint_time": "2026-10-03T07:15:00-03:00",
        "checkpoint_tz": null,
        "courier_status": "OEC",
        "message": "Objeto saiu para entrega ao destinatário",
        "location": "CDD Campinas - SP"
      },
      {
        "checkpoint_id": "cp_0005",
        "checkpoint_time": "2026-10-03 09:30:00",
        "checkpoint_tz": "-03:00",
        "courier_status": "RX9",
        "message": "Objeto aguardando confirmação de entrega pelo destinatário",
        "location": "CDD Campinas - SP"
      },
      {
        "checkpoint_id": "cp_0006",
        "checkpoint_time": "2026-10-01 18:20:00",
        "checkpoint_tz": "-03:00",
        "courier_status": "RO",
        "message": "Objeto em trânsito - por favor aguarde",
        "location": "CTE Vila Maria - SP"
      }
    ]
  }
}
```

Resposta de `POST /v1/shipments` com o relógio parado em 03/10/2026 14:00 UTC:

```json
{
  "id": "shp_exemplo",
  "tracking_code": "QB000000002BR",
  "carrier": "correios",
  "reference": "campanha-42/criador-7",
  "status": "saiu_para_entrega",
  "status_reason": null,
  "posted_at": "2026-10-01T13:02:00Z",
  "delivered_at": null,
  "delay": {
    "late": false,
    "delivered_late": false,
    "limit_days": 7,
    "elapsed_days": 2,
    "late_since": null,
    "summary": "Postado há 2 dias e 58 min; o limite é de 7 dias.",
    "alert": null
  },
  "unmapped_events": 1,
  "history": [
    {
      "occurred_at": "2026-10-01T13:02:00Z",
      "status": "postado",
      "raw_status": "PO",
      "description": "Objeto postado",
      "location": "AGF Pinheiros - SP",
      "received_at": "2026-10-03T14:00:00Z"
    },
    {
      "occurred_at": "2026-10-01T21:20:00Z",
      "status": "em_transito",
      "raw_status": "RO",
      "description": "Objeto em trânsito - por favor aguarde",
      "location": "CTE Vila Maria - SP",
      "received_at": "2026-10-03T14:00:00Z"
    },
    {
      "occurred_at": "2026-10-02T11:40:00Z",
      "status": "em_transito",
      "raw_status": "RO",
      "description": "Objeto em trânsito - por favor aguarde",
      "location": "CTE Cajamar - SP",
      "received_at": "2026-10-03T14:00:00Z"
    },
    {
      "occurred_at": "2026-10-03T10:15:00Z",
      "status": "saiu_para_entrega",
      "raw_status": "OEC",
      "description": "Objeto saiu para entrega ao destinatário",
      "location": "CDD Campinas - SP",
      "received_at": "2026-10-03T14:00:00Z"
    },
    {
      "occurred_at": "2026-10-03T12:30:00Z",
      "status": null,
      "raw_status": "RX9",
      "description": "Objeto aguardando confirmação de entrega pelo destinatário",
      "location": "CDD Campinas - SP",
      "received_at": "2026-10-03T14:00:00Z"
    }
  ],
  "last_synced_at": "2026-10-03T14:00:00Z",
  "stale": false,
  "sync_error": null
}
```
<!-- exemplo:fim -->

## Status desconhecido, eventos repetidos e fora de ordem

**Status desconhecido não vira entregue.** Não há busca por palavra: "Entrega não realizada", "Entregue ao remetente" e "Entrega agendada" contêm "entreg" e nenhum é entrega ao criador. A mensagem do checkpoint nunca decide o status. Código fora da tabela entra no histórico com `status: null` e o texto original, mas não muda o status, não inicia nem encerra a contagem de trânsito e aumenta `unmapped_events`. Um teste fixa a lista fechada de códigos que levam a `entregue`.

Mandar o desconhecido para `excecao` também evitaria o falso "entregue", mas abriria alarme a cada texto novo da transportadora, e a maioria é variação de trânsito. Por isso o desconhecido fica visível, mas neutro.

**Fora de ordem não regride.** O status não é atualizado evento a evento. Ele é recalculado a partir do histórico inteiro (`src/domain/status.ts`):

1. qualquer `entregue` encerra;
2. se o evento reconhecido mais recente (pelo horário da transportadora) for `excecao`, vale a exceção;
3. senão, vale o maior progresso já visto: `postado` < `em_transito` < `saiu_para_entrega` < `entregue`.

O resultado não depende da ordem de chegada. Um teste confirma o mesmo status e o mesmo atraso nas 720 ordens possíveis de um histórico de 6 eventos. A exceção aparece enquanto for o fato mais recente e some quando chega progresso posterior.

**Consultar de novo não duplica.** Cada evento é identificado pelo conteúdo: SHA-256 de transportadora, código bruto, horário em segundos UTC e local. O banco tem `UNIQUE (shipment_id, event_key)` e a gravação ignora o que já existe. O mesmo evento reenviado com outro id do agregador continua sendo um só.

## Como o atraso é detectado sem marcar entrega normal como atraso

`assessDelay` (`src/domain/delay.ts`) é uma função pura que recebe o histórico, o limite e o "agora" de um relógio injetado. Os testes usam relógio fixo.

- **Início:** o primeiro evento de progresso reconhecido, normalmente `postado`. Se a transportadora pular a postagem, vale o primeiro `em_transito`.
- **Fim:** o horário da entrega informado pela transportadora. Sem entrega, o "agora".
- **Atrasado:** tempo decorrido **estritamente maior** que o limite. No limite exato, ainda não está atrasado. O cálculo é feito em milissegundos; dias só aparecem na exibição.
- **Exceção não para o relógio.** Pacote devolvido ou parado continua contando, e o aviso vale porque o produto não chegou.

O que impede a entrega normal de virar atraso:

1. Pacote entregue é medido até o horário da entrega, não até a consulta. Entregue em 2 dias e 4 h e consultado um mês depois continua com 2 dias e 4 h.
2. A contagem começa na postagem, não no cadastro. O código pode ser cadastrado dias antes do envio, e essa espera não conta.
3. Os horários viram instantes UTC no adaptador, então `-03:00` contra UTC não cria horas de atraso fantasma.
4. Se o aviso já saiu e depois chega um `entregue` com horário dentro do limite (o evento atrasou no agregador), o recálculo desfaz o aviso com o motivo e envia um aviso de `atraso_desfeito`.
5. Entrega depois do limite continua marcada (`delivered_late: true`). Isso é atraso real.

O monitor (`checkDelays`) roda em intervalo, sincroniza as encomendas ainda não entregues e grava no máximo um aviso por encomenda. Rodar de novo não avisa de novo. Os avisos vão para um `Notifier`; o padrão grava uma linha JSON no log.

## Como trocar de agregador

O resto do código só conhece a interface `TrackingProvider` e o tipo `TrackingEvent` (`src/domain/types.ts`). Tudo o que é do agregador fictício fica em `src/providers/rastreio-fake/`: nomes de campo, tabela de tradução, fuso dos horários e códigos de erro HTTP.

Para usar outro agregador:

1. criar `src/providers/<novo>/` com um cliente que implemente `TrackingProvider` e traduza o formato e os status para `TrackingEvent`;
2. trocar a linha que instancia o cliente em `src/main.ts`.

Garantias:

- `test/provider-boundary.test.ts` falha se outro arquivo de `src/` além de `src/main.ts` importar o adaptador, ou se nomes de campo do agregador (`checkpoint_time`, `courier_status` etc.) aparecerem fora dele.
- `test/service.test.ts` roda os mesmos testes com dois provedores: o cliente HTTP contra o agregador fictício e um provedor em memória que já fala o formato do domínio.

## Limitações

- **Volta legítima de status.** Se a transportadora registrar "em trânsito" depois de "saiu para entrega" com horário mais novo, o status mostrado continua `saiu_para_entrega`. A volta aparece só no histórico.
- **Eventos idênticos.** Dois eventos iguais no mesmo segundo e no mesmo local viram um. Isso não muda status nem prazo.
- **Dias corridos.** O limite não considera dias úteis nem feriados.
- **Horário sem fuso** é tratado como `-03:00` (horário de Brasília, sem horário de verão desde 2019).
- **Monitor depende do agregador.** Com o agregador fora do ar, ele avalia com o histórico guardado e marca o aviso com `stale`.
- **Status desconhecido** não gera alerta próprio, só a contagem `unmapped_events`. Quem cuida das tabelas precisa olhar essa contagem.
- **Sem webhook.** O serviço consulta o agregador. Um webhook usaria o mesmo caminho de gravação idempotente.

## Uso de IA

### Feito com IA

Ferramenta: Claude Code, modelo Claude Opus 5.5.

- **Plano:** análise do enunciado, plano de implementação e escolhas de projeto (regra de status por histórico, chave de evento por conteúdo, início do atraso na postagem).
- **Código:** todo o código de `src/`, o agregador fictício em `mock-aggregator/`, o script do exemplo e a especificação OpenAPI exibida em `/docs`.
- **Testes:** todos os testes.
- **README:** este texto.
- **Verificação feita pela IA:**
  - rodou `npm test` e `npm run typecheck`;
  - subiu o agregador fictício e a API e testou os quatro cenários com `curl`, inclusive com o agregador derrubado;
  - injetou defeitos de propósito para conferir se os testes os pegavam: tradução por busca de palavra, atraso medido até a consulta mesmo com entrega, vazamento de campo do agregador e status igual ao último evento.
- **Correções que vieram dessa verificação:**
  - faltava teste para evento mais novo com progresso menor;
  - o aviso dizia "em trânsito" para pacote devolvido;
  - o arredondamento mostrava "72 h, acima do limite de 72 h";
  - prazos e tempos apareciam em horas ("263,8 h"); passaram a ser mostrados em dias, horas e minutos.

### O que eu revisei

<!-- pendente: escrito pela pessoa candidata -->

### Verificações automáticas

`npm test` e `npm run typecheck` passam. `npm run example` sai com erro se o exemplo acima estiver desatualizado.
