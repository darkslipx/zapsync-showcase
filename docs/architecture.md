# Arquitetura

[![Português](https://img.shields.io/badge/-Portugu%C3%AAs-009C3B?style=for-the-badge)](architecture.md) [![English](https://img.shields.io/badge/-English-lightgrey?style=for-the-badge)](architecture.en.md)

## Componentes

| Componente | Onde | Responsabilidade |
|---|---|---|
| Site + painel do dono + painel do operador | Vercel (estático, sem build) | Cadastro, conexão do WhatsApp, gestão do dia a dia |
| API | Railway, Node.js + Express | Processamento do webhook, IA, API do painel, cobrança, agendadores |
| Banco de dados | PostgreSQL no Railway | Negócios, usuários, mensagens, pedidos, agendamentos, cardápio, log de auditoria |
| WhatsApp | Meta Cloud API (oficial) | Receber e enviar mensagens, mídia, Embedded Signup |
| IA | OpenAI, Groq | Respostas, extração de pedido e agendamento, transcrição de áudio |
| Cobrança | Assinaturas do Mercado Pago | Checkout hospedado, cobrança recorrente, webhooks de status |

## Ciclo da mensagem

```mermaid
sequenceDiagram
  participant C as Cliente
  participant M as Meta Cloud API
  participant W as /webhook
  participant AI as Cascata de IA
  participant DB as PostgreSQL
  C->>M: "2 pizzas de calabresa pra entrega"
  M->>W: POST (X-Hub-Signature-256)
  W->>W: valida o HMAC, responde 200 rápido
  W->>W: deduplica o id, rate limit por negócio, junta mensagens em sequência
  W->>DB: acha o negócio pelo phone_number_id, carrega histórico + cardápio
  W->>AI: prompt (tom do negócio + cardápio + histórico)
  AI-->>W: resposta (+ pedido estruturado quando detectado)
  W->>DB: salva a mensagem e o pedido (protegido contra duplicidade)
  W->>M: envia a resposta
  M->>C: "Anotado! 2 pizzas de calabresa, R$ 109,80 + entrega..."
```

Se todas as tentativas de IA falharem, o cliente ainda recebe uma resposta pronta e segura, para ninguém ficar no vácuo.

## Ciclo da cobrança

```mermaid
stateDiagram-v2
  [*] --> Checkout: visitante clica em "Assinar"
  Checkout --> Convidado: webhook do Mercado Pago "authorized"
  Convidado --> Ativo: dono cria a conta pelo convite de uso único
  Ativo --> Tolerancia: pagamento falhou ou foi cancelado
  Tolerancia --> Ativo: pagamento regularizado
  Tolerancia --> Suspenso: fim da tolerância (login e bot param, dados mantidos)
  Suspenso --> Ativo: pagamento regularizado
```

## Isolamento entre negócios

```mermaid
flowchart TD
  R[Requisição para /admin/api/*] --> S{Sessão assinada válida?<br/>usuário ativo, versão do token ok}
  S -- não --> U[401]
  S -- sim --> B[business_id só da sessão]
  B --> Q[Todo SQL filtrado por business_id]
  Q --> N{Achou a linha?}
  N -- não --> F[404, mesma resposta para<br/>'não existe' e 'não é seu']
  N -- sim --> OK[200]
```

## Tarefas agendadas

| Tarefa | O que faz |
|---|---|
| Lembrete de agendamento | Envia um template de WhatsApp antes de cada horário marcado |
| Alerta de pedido travado | Avisa o dono sobre pedidos pendentes há tempo demais |
| Follow-up pós-entrega | Pede uma avaliação ao cliente |
| Resumo diário | Manda ao dono os números do dia |
| Retenção (LGPD) | Apaga o histórico de conversa mais antigo que o prazo de retenção |
| Guarda da assinatura | Move os negócios entre ativo, tolerância e suspenso |
