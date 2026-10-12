import { NORMALIZED_STATUSES } from "./domain/types.ts";
import { MAX_LIMIT_DAYS } from "./schema.ts";

// Contrato da API em OpenAPI 3.1, servido em /openapi.json e exibido pelo Scalar em /docs.
// test/openapi.test.ts confere que as rotas e os campos das respostas batem com o código.

const errorResponse = (description: string, example: Record<string, unknown>) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: example } } },
});

const shipmentExample = {
  id: "shp_5f0a4b64-e1ec-45b8-b567-99c63148e6c7",
  tracking_code: "QB000000002BR",
  carrier: "correios",
  reference: "campanha-42/criador-7",
  status: "saiu_para_entrega",
  status_reason: null,
  posted_at: "2026-10-01T13:02:00Z",
  delivered_at: null,
  delay: {
    late: false,
    delivered_late: false,
    limit_days: 7,
    elapsed_days: 2,
    late_since: null,
    summary: "Postado há 2 dias e 58 min; o limite é de 7 dias.",
    alert: null,
  },
  unmapped_events: 1,
  history: [
    {
      occurred_at: "2026-10-01T13:02:00Z",
      status: "postado",
      raw_status: "PO",
      description: "Objeto postado",
      location: "AGF Pinheiros - SP",
      received_at: "2026-10-03T14:00:00Z",
    },
    {
      occurred_at: "2026-10-03T10:15:00Z",
      status: "saiu_para_entrega",
      raw_status: "OEC",
      description: "Objeto saiu para entrega ao destinatário",
      location: "CDD Campinas - SP",
      received_at: "2026-10-03T14:00:00Z",
    },
    {
      occurred_at: "2026-10-03T12:30:00Z",
      status: null,
      raw_status: "RX9",
      description: "Objeto aguardando confirmação de entrega pelo destinatário",
      location: "CDD Campinas - SP",
      received_at: "2026-10-03T14:00:00Z",
    },
  ],
  last_synced_at: "2026-10-03T14:00:00Z",
  stale: false,
  sync_error: null,
};

const nullable = (schema: Record<string, unknown>) => ({ ...schema, type: [schema.type as string, "null"] });

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Rastreio do produto físico",
    version: "1.0.0",
    description: [
      "Cadastra códigos de rastreio num agregador, traduz o dialeto de cada transportadora para cinco status estáveis e avisa quando o tempo em trânsito passa do limite.",
      "",
      "- Status desconhecido da transportadora fica no histórico com `status: null` e nunca vira `entregue`.",
      "- Evento antigo que chega depois não faz o status voltar.",
      "- Consultar de novo não duplica o histórico.",
      "",
      "Para testar localmente, suba o agregador fictício (`npm run mock-aggregator`) e use os códigos `QB000000001BR` a `QB000000004BR` com `carrier: correios`.",
    ].join("\n"),
  },
  servers: [{ url: "/", description: "Este servidor" }],
  tags: [
    { name: "Encomendas", description: "Cadastro e consulta de rastreio" },
    { name: "Atrasos", description: "Avisos de tempo em trânsito acima do limite" },
    { name: "Saúde" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Saúde"],
        summary: "Checagem de saúde",
        responses: {
          "200": {
            description: "Serviço no ar",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Health" }, example: { ok: true } } },
          },
        },
      },
    },
    "/v1/shipments": {
      post: {
        tags: ["Encomendas"],
        summary: "Cadastrar código de rastreio",
        description:
          "Cadastra o código no agregador, grava a encomenda e já faz a primeira consulta. Cadastrar de novo o mesmo código e transportadora devolve a encomenda existente com 200, sem duplicar.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RegisterRequest" },
              examples: {
                exemplo: {
                  summary: "Fora de ordem, repetido e com status inventado",
                  value: { tracking_code: "QB000000002BR", carrier: "correios", reference: "campanha-42/criador-7" },
                },
                entregue: { summary: "Entrega normal no prazo", value: { tracking_code: "QB000000001BR", carrier: "correios" } },
                atrasado: {
                  summary: "Parado em trânsito, passa do limite",
                  value: { tracking_code: "QB000000003BR", carrier: "correios", transit_limit_days: 5 },
                },
                devolvido: { summary: "Entregue ao remetente (exceção)", value: { tracking_code: "QB000000004BR", carrier: "correios" } },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Encomenda cadastrada",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Shipment" }, example: shipmentExample } },
          },
          "200": {
            description: "Código já cadastrado; devolve a encomenda existente",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Shipment" }, example: shipmentExample } },
          },
          "400": errorResponse("JSON malformado ou campo inválido", {
            code: "payload_invalido",
            message: "use de 8 a 40 letras ou números, sem espaços",
            field: "tracking_code",
          }),
          "413": errorResponse("Corpo acima de 16 KiB", { code: "payload_grande_demais", message: "O corpo passa de 16 KiB." }),
          "422": errorResponse("Transportadora não suportada", {
            code: "transportadora_nao_suportada",
            message: "Transportadora não suportada: fedex.",
            field: "carrier",
          }),
          "502": errorResponse("O agregador falhou no cadastro; nada foi gravado", {
            code: "agregador_indisponivel",
            message: "Não foi possível cadastrar no agregador: O agregador não respondeu em 5000 ms.",
          }),
        },
      },
    },
    "/v1/shipments/{id}": {
      get: {
        tags: ["Encomendas"],
        summary: "Consultar status",
        description:
          "Sincroniza com o agregador, grava só os eventos novos e devolve o estado. Se o agregador falhar, devolve 200 com o estado guardado, `stale: true` e `sync_error`.",
        parameters: [
          { name: "id", in: "path", required: true, description: "Id devolvido no cadastro", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Estado da encomenda",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Shipment" }, example: shipmentExample } },
          },
          "404": errorResponse("Encomenda inexistente", { code: "encomenda_nao_encontrada", message: "Não há encomenda com esse id." }),
        },
      },
    },
    "/v1/alerts": {
      get: {
        tags: ["Atrasos"],
        summary: "Listar avisos de atraso",
        description: "Um aviso por encomenda. Fica `desfeito` se depois chegar uma entrega que ocorreu dentro do limite.",
        responses: {
          "200": {
            description: "Avisos, abertos e desfeitos",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AlertList" },
                example: {
                  alerts: [
                    {
                      shipment_id: "shp_52187175-4be9-4fee-b7b6-25961c71f951",
                      tracking_code: "QB000000003BR",
                      carrier: "correios",
                      reference: null,
                      kind: "transito_acima_do_limite",
                      status: "ativo",
                      limit_days: 7,
                      late_since: "2026-09-27T13:00:00Z",
                      opened_at: "2026-10-12T12:48:27Z",
                      updated_at: "2026-10-12T12:48:27Z",
                      resolution: null,
                      stale: false,
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Health: {
        type: "object",
        required: ["ok"],
        properties: { ok: { type: "boolean" } },
      },
      RegisterRequest: {
        type: "object",
        additionalProperties: false,
        required: ["tracking_code", "carrier"],
        properties: {
          tracking_code: { type: "string", pattern: "^[A-Za-z0-9]{8,40}$", description: "Guardado em maiúsculas", example: "QB000000002BR" },
          carrier: { type: "string", enum: ["correios", "jadlog", "loggi"] },
          transit_limit_days: {
            type: "integer",
            minimum: 1,
            maximum: MAX_LIMIT_DAYS,
            description: "Limite de trânsito em dias corridos. Sem ele, vale TRANSIT_LIMIT_DAYS (padrão 7).",
          },
          reference: { type: "string", maxLength: 200, description: "Texto livre para ligar a encomenda à campanha" },
        },
      },
      Status: {
        type: ["string", "null"],
        enum: [...NORMALIZED_STATUSES, null],
        description: "null quando ainda não há evento reconhecido (ou, no histórico, quando a transportadora mandou um status desconhecido)",
      },
      HistoryEntry: {
        type: "object",
        required: ["occurred_at", "status", "raw_status", "description", "location", "received_at"],
        properties: {
          occurred_at: { type: "string", format: "date-time", description: "Horário do evento na transportadora, em UTC" },
          status: { $ref: "#/components/schemas/Status" },
          raw_status: { type: "string", description: "Código original da transportadora" },
          description: { type: "string" },
          location: { type: ["string", "null"] },
          received_at: { type: "string", format: "date-time", description: "Quando o evento chegou até nós" },
        },
      },
      Delay: {
        type: "object",
        required: ["late", "delivered_late", "limit_days", "elapsed_days", "late_since", "summary", "alert"],
        properties: {
          late: { type: "boolean", description: "Tempo em trânsito estritamente maior que o limite" },
          delivered_late: { type: "boolean" },
          limit_days: { type: "integer" },
          elapsed_days: { type: ["number", "null"], description: "Da postagem até a entrega (ou até agora), com uma casa decimal" },
          late_since: { type: ["string", "null"], format: "date-time" },
          summary: { type: "string", description: "Frase pronta para exibir, com datas no horário de Brasília" },
          alert: nullable({ type: "string", enum: ["ativo", "entregue_com_atraso", "desfeito", null] }),
        },
      },
      Shipment: {
        type: "object",
        required: [
          "id",
          "tracking_code",
          "carrier",
          "reference",
          "status",
          "status_reason",
          "posted_at",
          "delivered_at",
          "delay",
          "unmapped_events",
          "history",
          "last_synced_at",
          "stale",
          "sync_error",
        ],
        properties: {
          id: { type: "string" },
          tracking_code: { type: "string" },
          carrier: { type: "string" },
          reference: { type: ["string", "null"] },
          status: { $ref: "#/components/schemas/Status" },
          status_reason: { type: ["string", "null"] },
          posted_at: { type: ["string", "null"], format: "date-time" },
          delivered_at: { type: ["string", "null"], format: "date-time" },
          delay: { $ref: "#/components/schemas/Delay" },
          unmapped_events: { type: "integer", description: "Eventos com status que não conhecemos" },
          history: { type: "array", items: { $ref: "#/components/schemas/HistoryEntry" }, description: "Em ordem cronológica, sem repetidos" },
          last_synced_at: { type: ["string", "null"], format: "date-time" },
          stale: { type: "boolean", description: "true quando o agregador falhou e o estado é o último guardado" },
          sync_error: nullable({ type: "string", enum: ["nao_encontrado", "indisponivel", "resposta_invalida", "rejeitado", null] }),
        },
      },
      Alert: {
        type: "object",
        required: [
          "shipment_id",
          "tracking_code",
          "carrier",
          "reference",
          "kind",
          "status",
          "limit_days",
          "late_since",
          "opened_at",
          "updated_at",
          "resolution",
          "stale",
        ],
        properties: {
          shipment_id: { type: "string" },
          tracking_code: { type: "string" },
          carrier: { type: "string" },
          reference: { type: ["string", "null"] },
          kind: { type: "string", enum: ["transito_acima_do_limite"] },
          status: { type: "string", enum: ["ativo", "entregue_com_atraso", "desfeito"] },
          limit_days: { type: "integer" },
          late_since: { type: "string", format: "date-time" },
          opened_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
          resolution: { type: ["string", "null"], description: "Por que o aviso foi desfeito" },
          stale: { type: "boolean" },
        },
      },
      AlertList: {
        type: "object",
        required: ["alerts"],
        properties: { alerts: { type: "array", items: { $ref: "#/components/schemas/Alert" } } },
      },
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              field: { type: "string", description: "Campo com problema, quando houver" },
            },
          },
        },
      },
    },
  },
} as const;
