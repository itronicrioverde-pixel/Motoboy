# Decisões de Arquitetura — Projeto Motoboy

Este documento registra decisões técnicas aprovadas para evitar mudanças de direção sem análise.

Cada nova decisão deverá informar:

- Status.
- Contexto.
- Decisão.
- Motivo.
- Consequências.
- Data.

---

## DEC-001 — Utilizar Vite sem React

**Status:** Aprovada  
**Data:** 28/08/2026

### Contexto

O projeto atual utiliza HTML, CSS e JavaScript. Adicionar React agora aumentaria o tamanho e o risco da migração.

### Decisão

Continuar utilizando Vite com TypeScript e DOM nativo.

### Motivo

Vite resolve módulos, dependências e build sem exigir a reconstrução completa da interface.

### Consequências

- O projeto não utilizará React nesta fase.
- As telas serão organizadas em templates e controladores TypeScript.
- React só poderá ser considerado futuramente mediante nova análise.

---

## DEC-002 — Migração progressiva

**Status:** Aprovada  
**Data:** 28/08/2026

### Contexto

O `index.html` concentra milhares de linhas e possui regras de negócio importantes.

### Decisão

Migrar uma funcionalidade por vez, preservando o funcionamento atual.

### Motivo

Uma reescrita completa teria alto risco de quebrar cálculos, rotas, clientes e registros financeiros.

### Consequências

- O código legado continuará existindo temporariamente.
- Cada etapa terá um commit separado.
- O legado só será removido depois que sua substituição estiver testada.

---

## DEC-003 — Clean Architecture por funcionalidade

**Status:** Aprovada  
**Data:** 28/08/2026

### Decisão

Organizar cada funcionalidade nas camadas:

- Domain.
- Application.
- Infrastructure.
- Presentation.

### Regras

- Domain não conhece Firebase, DOM ou localStorage.
- Application depende de interfaces.
- Infrastructure implementa Firebase e armazenamento.
- Presentation controla telas e eventos.

### Consequências

Cada funcionalidade poderá ser testada e modificada isoladamente.

---

## DEC-004 — Firebase como infraestrutura

**Status:** Aprovada  
**Data:** 28/08/2026

### Decisão

Utilizar:

- Firebase Authentication para identidade.
- Firestore para os dados dos usuários.
- Firebase Emulator Suite para testes.
- Cloud Functions somente para operações privilegiadas.

### Consequências

O domínio não poderá importar diretamente bibliotecas do Firebase.

---

## DEC-005 — Separação dos dados pelo UID

**Status:** Aprovada  
**Data:** 28/08/2026

### Decisão

Cada motoboy terá seus dados dentro da própria subárvore:

`users/{uid}/...`

### Consequências

- Um usuário não poderá consultar dados de outro.
- Cache local também deverá ser separado pelo UID.
- Nenhum e-mail ou UID será fixado no código.

---

## DEC-006 — Firestore será a fonte oficial

**Status:** Aprovada para a arquitetura final  
**Data:** 28/08/2026

### Decisão

Depois da migração, o Firestore será a fonte oficial dos registros autenticados.

O armazenamento local será utilizado somente como:

- Cache.
- Estado temporário da interface.
- Fila de sincronização controlada.

### Consequências

Nenhuma funcionalidade financeira poderá depender exclusivamente do localStorage na versão comercial.

---

## DEC-007 — Integridade financeira

**Status:** Aprovada para implementação futura  
**Data:** 28/08/2026

### Decisão

- Valores monetários serão armazenados em centavos.
- Registros financeiros não serão apagados definitivamente.
- Exclusões serão cancelamentos auditáveis.
- Operações relacionadas deverão ser transacionais.
- Totais mensais serão resultados derivados.

### Consequências

Será necessária uma migração controlada dos registros existentes.

---

## DEC-008 — Pontes globais são temporárias

**Status:** Aprovada  
**Data:** 28/08/2026

### Decisão

As funções `window.__motoboy...` serão mantidas somente durante a migração.

### Consequências

- Não criar novas regras de negócio nessas pontes.
- Remover cada ponte quando a respectiva funcionalidade deixar o monólito.
- A arquitetura final não dependerá de variáveis globais.

---

## DEC-009 — Alterações pequenas e verificáveis

**Status:** Aprovada  
**Data:** 28/08/2026

### Decisão

Cada etapa deve:

- Possuir objetivo único.
- Apresentar o Git diff.
- Executar typecheck e build.
- Ter critérios de aceitação.
- Ser salva em commit separado.
- Não realizar deploy sem autorização.

### Consequências

Nenhum agente deverá implementar todo o plano de migração de uma vez.

---

## DEC-010 — Mecanismo temporário de carregamento do painel legado

**Status:** Aprovada
**Data:** 29/08/2026

### Contexto

O JavaScript do painel vivia inline no `index.html` e era executado antes da autenticação. A Etapa 1A o extraiu para `src/legacy/panel.js` a fim de permitir, na Etapa 1B, controlar quando ele inicializa. O scan de strict mode (node --check em módulo; ausência de `this` de topo, `with`, `document.write`, octais e globais implícitas) passou sem bloqueadores, viabilizando um módulo ES.

### Decisão

- `src/legacy/panel.js` é um **módulo temporário** durante a migração; será removido na Etapa 10.
- `bootstrapPanel()` é o **ponto explícito e único de inicialização** do código legado.
- `window.setView` é mantido **temporariamente**, exclusivamente por causa do `onclick` legado remanescente no HTML.
- **Nenhuma nova regra de negócio** poderá ser adicionada ao módulo legado.
- A **Etapa 1B** criará uma **única entrada autenticada** que chamará `bootstrapPanel()` apenas para usuário autenticado e verificado, uma vez.
- No **logout**, a Etapa 1B deverá **desmontar completamente o painel ou recarregar a página após o `signOut`**; apenas sobrepor o login **não** será considerado proteção suficiente.
- Se o módulo ES vier a ser incompatível com strict mode, esta decisão deverá ser **revisada** antes de recorrer a script clássico (`public/legacy`). Scan atual: compatível.

### Consequências

- Na Etapa 1A, `bootstrapPanel()` é chamado de forma **incondicional** em `src/main.ts` (comportamento idêntico ao anterior).
- A proteção real da inicialização depende da Etapa 1B (ainda não autorizada).
- O contrato de pontes `window.__motoboy*` / `window.__applyRemote*` é preservado.

---

## DEC-011 — Camada compartilhada de notificações

**Status:** Aprovada
**Data:** 29/08/2026

### Contexto

O app usa diálogos nativos do navegador (`alert`) para sucesso, validação e erro. Eles têm aparência branca fora do tema, bloqueiam o fluxo e não seguem a acessibilidade do produto.

### Decisão

- Criar uma **camada compartilhada de UI** em `src/shared/presentation/notifications/` (Etapa 1D).
- **Diálogos nativos do navegador não serão usados** (`alert`/`confirm`/`prompt`).
- **Toast** será usado para **sucesso, informação, aviso e erro NÃO bloqueante**.
- **Validações específicas de campo** devem migrar para **mensagens inline** quando cada feature for extraída (não agora).
- **Confirmações destrutivas** continuarão no **modal atual** (`requestDeleteConfirmation`) por enquanto.
- Um **`confirmDialog` baseado em Promise** só será criado quando houver **migração real** das confirmações.
- **Nenhuma API será exposta em `window`** (o componente é um módulo ES importado por `main.ts` e pelo módulo legado).
- O **componente compartilhado não pode conter regras de negócio**.

### Consequências

- 1D-A cria apenas o `showToast` (sem substituir nenhum `alert` ainda).
- As substituições de `alert` por toast virão em etapas seguintes (1D-B+).
- O modal de confirmação e a eventual API assíncrona ficam para uma etapa futura autorizada.

---

## DEC-012 — Firestore como fonte oficial dos dados financeiros e persistência do `fsId`

**Status:** Aprovada
**Data:** 30/08/2026

### Contexto

A auditoria de persistência e sincronização (ver `CURRENT_STATE.md`, seções 9 a 12) confirmou que abastecimentos, manutenções e entradas manuais gravam no Firestore por ponte, mas o vínculo entre o registro local e o documento remoto (`fsId`) podia se perder: o `saveLocalState()` rodava de forma síncrona **antes** do retorno do `addDoc`, e o `fsId` recebido depois só era escrito em memória, nunca re-persistido. Isso causa registros "não sincronizados", possível duplicação ao recarregar e atualizações/exclusões que não encontram o documento remoto.

A Etapa 2A corrige **somente** essa perda de vínculo para **novos** registros. Ela **não** resolve toda a diferença entre celular e computador (carga inicial, conflitos, offline e `onSnapshot` seguem fora de escopo).

### Decisão

Direção arquitetural registrada (parte já aprovada em decisões anteriores, consolidada aqui):

- O **Firestore será a única fonte oficial** dos dados financeiros.
- O `localStorage` financeiro atual é **transitório** e será eliminado após a migração.
- O `localStorage` ficará **somente para preferências não financeiras**.
- O **estado da interface** será mantido em memória e alimentado pelos repositórios.
- **Cada feature terá repository próprio.**
- Dados serão isolados por `users/{uid}/...`.
- **IDs do Firestore serão a identidade oficial** dos registros.
- `createdAt` e `updatedAt` usarão **timestamp do servidor**.
- `effectiveDate` representará a **data real do lançamento** (distinta do carimbo de criação).
- Estados de **loading, sincronizando, offline e erro** deverão ser visíveis.
- Os **dados fictícios serão apagados** antes de usuários reais; **não haverá migração** dos dados fictícios.
- A **persistência offline permanente do Firestore** será decidida posteriormente, considerando dispositivo confiável.
- `controlStartMonth` será criado por usuário na etapa de **perfil/onboarding**.
- Esta **etapa de `fsId` é transitória** e **não** transforma o `localStorage` em fonte oficial.

### Escopo aplicado nesta etapa (2A)

- Correção aplicada **apenas a novos registros** de abastecimentos, manutenções e entradas manuais.
- Após a criação remota concluir com sucesso: valida que o ID é uma string não vazia, **reencontra o registro no estado atual** e confirma que ele ainda existe antes de definir o `fsId`, e só então executa `saveLocalState()`.
- **Não** cria segundo documento remoto, **não** altera valores financeiros, **não** altera a identidade das rotas (que já usa ID estável), **não** corrige registros antigos sem `fsId` e **não** reconcilia duplicatas existentes.
- Em falha remota (Promise rejeitada ou `id` inválido) o `fsId` **não** é persistido; o cache local é mantido.

### Nota técnica de identidade local

Os VMs legados (`refuels`, `maintenances`, `entradas`) **não possuem um campo de ID local persistente**; sua identidade em memória é a própria referência do objeto no array. Nesta etapa a reassociação após o retorno remoto é feita reencontrando o registro **no array vivo** (`indexOf` na variável de módulo, que os hooks `__applyRemote*` podem reatribuir) e confirmando que ele ainda existe, em vez de introduzir um novo campo de identidade local — o que seria uma mudança de forma de dado fora do escopo autorizado. A adoção de um ID local estável persistente (alinhado a "IDs do Firestore serão a identidade oficial") fica para uma etapa futura da estratégia de sincronização (Etapa 5).

### Consequências

- Novos lançamentos passam a manter o `fsId` após recarregar a página, reduzindo o risco de duplicação e de operações que não encontram o documento remoto.
- A diferença total entre dispositivos **permanece em aberto**: carga inicial, conflitos, offline e `onSnapshot` continuam fora de escopo e serão tratados na Etapa 5.
- Nenhuma mudança de schema do Firestore, regras, coleções ou dados foi feita nesta etapa.

---

## DEC-013 — Modelo financeiro normalizado

**Status:** Aprovada (desenho) — implementação não iniciada
**Data:** 30/08/2026

### Contexto

Clientes, contas a receber e recebimentos vivem no monólito e no `localStorage`, sem sincronização entre aparelhos e com valores em ponto flutuante. A Etapa 3A auditou o modelo atual e definiu o desenho de destino. Esta decisão registra **apenas o desenho aprovado**; nada foi implementado, publicado ou migrado.

### Decisão

- O financeiro passa a viver em **quatro coleções por usuário**, sob `users/{uid}/`:
  - `clients/{clientId}`
  - `receivables/{receivableId}`
  - `payments/{paymentId}`
  - `incomeEntries/{entryId}`
- **Firestore é a fonte oficial** dos dados financeiros autenticados.
- **Valores monetários em centavos inteiros** (`int`), nunca float.
- **`effectiveDate`** (data real do lançamento, `AAAA-MM-DD`) é **separado** de `createdAt`/`updatedAt` (que usam `serverTimestamp`).
- **`remainingCents` é calculado** (`amountCents - paidCents`) e **nunca persistido**.
- **`clientId` é a única identidade** do cliente. **Nomes duplicados são permitidos**; o nome nunca é usado como chave de relacionamento. Campos opcionais de diferenciação (`phone`, `nickname`, `notes`) podem existir; a UI pode alertar sobre nomes semelhantes, mas **não funde históricos** automaticamente. Renomear não gera cascata.

### Invariante de Receivable

- `status == 'cancelled'` ⇒ `paidCents == 0`.
- Quando **não** cancelado:
  - `open` ⇒ `paidCents == 0`;
  - `partial` ⇒ `0 < paidCents < amountCents`;
  - `paid` ⇒ `paidCents == amountCents`.
- Sempre: `0 ≤ paidCents ≤ amountCents`.

### Estado de implementação

- Decisão arquitetural **aprovada**. As coleções, o código e os índices **ainda não existem**; nenhum documento foi criado; nenhum deploy foi feito.

### Consequências

- Um repositório por coleção (encaixe direto na Clean Architecture já usada nas features atuais).
- O `localStorage` financeiro será eliminado no cutover (ver DEC-017); até lá, o comportamento atual permanece intacto.

---

## DEC-014 — IncomeEntry como única fonte do faturamento

**Status:** Aprovada (desenho) — implementação não iniciada
**Data:** 30/08/2026

### Contexto

Hoje a receita é somada a partir de um array `entradas` que mistura entradas manuais, rota paga na hora e recebimentos — com risco de dupla contagem. A Etapa 3A definiu uma fonte única.

### Decisão

- **Gráficos, totais e faturamento leem somente `incomeEntries`.**
- Toda receita de rota segue a mesma cadeia: **Route Service → Receivable → Payment → IncomeEntry**. **Não existe atalho `route_cash`.**
- **`Receivable` e pagamento pendente não entram no faturamento.**
- Valores de `incomeEntry` são **sempre positivos**; o sinal é dado por **`direction: 'credit' | 'debit'`** (líquido = `Σ credit − Σ debit`).
- **Todo `IncomeEntry` é imutável, inclusive o de origem manual.** O modelo **não** possui `cancelledAt` nem `updatedAt`.
- **Correção ou cancelamento gera um novo lançamento compensatório** (`debit`/`credit`), nunca edição ou exclusão.

### Estado de implementação

- Decisão **aprovada**. Nenhuma coleção `incomeEntries`, consulta de gráfico ou lançamento existe ainda; os gráficos atuais continuam lendo o modelo legado até o cutover.

### Consequências

- Faturamento sem dupla contagem, auditável e reconstruível a partir dos lançamentos.

---

## DEC-015 — Operações financeiras atômicas no servidor

**Status:** Aprovada (desenho) — implementação e deploy não realizados
**Data:** 30/08/2026

### Contexto

As operações financeiras compostas (rateio, confirmação/cancelamento de rota, estorno) precisam de atomicidade e de validação que o cliente não pode garantir sozinho.

### Decisão

- As seguintes operações serão **Cloud Functions callable transacionais** (Admin SDK):
  - `recordClientPayment`
  - `confirmRoute`
  - `cancelRoute`
  - `reversePayment`
  - `cancelReceivable`
  - `createManualIncome`
  - `reverseManualIncome`
- Operações compostas usam **`runTransaction`** (todas as leituras, validações, updates e creates na mesma transação).
- Rateio **FIFO** (conta aberta mais antiga primeiro) com **`MAX_FIFO = 100`**.
- **`MAX_FIFO` é um limite operacional deliberado do produto**, justificado por **latência** (transação curta), **contenção** (menos locks concorrentes), **tamanho do documento `Payment`** (array `allocations` enxuto), **volume previsível de leituras/atualizações** e **previsibilidade operacional** — **não** por um suposto teto fixo de 500 writes por transação. A consulta usa `limit(MAX_FIFO + 1)` e **rejeita a operação inteira** quando houver mais de 100 recebíveis elegíveis; **nunca** faz rateio parcial silencioso.
- **O cliente não escreve diretamente em `incomeEntries`** (nem em `payments`, `receivables.paidCents`/`status`).
- **`cancelRoute` nunca estorna pagamentos automaticamente.** Ele **rejeita** se algum receivable da rota possuir `paidCents > 0`; o pagamento precisa ser revertido **explicitamente** (`reversePayment`) antes, e só então `cancelRoute` cancela os recebíveis abertos.

### Precisão transacional de cancelRoute

- A **transação começa antes da consulta**.
- A consulta filtra **`sourceType == 'route'` e `sourceId == routeId`**.
- **Leitura, validação de `paidCents`, cancelamento dos recebíveis e atualização da rota ocorrem dentro da mesma transação.**
- **Não pode existir janela de concorrência** entre a validação e a escrita.

### Estado de implementação

- Decisão **aprovada**. **Nenhuma Cloud Function foi implementada nem publicada**; o projeto ainda não possui `functions/`; nenhuma callable existe. Depende de configuração de billing/deploy em etapa futura autorizada.

### Consequências

- Invariantes financeiras garantidas fora do cliente; será necessário índice composto para o FIFO (registrado como implementação futura, sem alterar índices agora).

---

## DEC-016 — Idempotência, reversão e imutabilidade

**Status:** Aprovada (desenho) — implementação não iniciada
**Data:** 30/08/2026

### Decisão

- **`Payment` é totalmente imutável.** O pagamento original **não recebe nenhum campo de retro-referência de reversão**; a ligação existe apenas do lado da reversão, via `reversesPaymentId`.
- **Reversão de pagamento** é um **novo `Payment`**:
  - `kind = 'reversal'`;
  - `amountCents` **positivo**;
  - `reversesPaymentId` = id do pagamento original;
  - **mesmas `allocations`** do original;
  - **ID determinístico `rev_{originalPaymentId}`** — sua existência **impede uma segunda reversão**.
- **`IncomeEntry` da reversão:** `direction = 'debit'`, `amountCents` positivo, **ID `inc_rev_{originalPaymentId}`**.
- **Entrada manual:**
  - criação via callable (`createManualIncome`), **ID determinístico `minc_{idempotencyKey}`**;
  - reversão via `reverseManualIncome`, **ID `revinc_{originalIncomeEntryId}`** (a existência do id impede segunda reversão).
- **`idempotencyKey`** validado antes de formar qualquer caminho do Firestore, com **`^[A-Za-z0-9_-]{1,64}$`** (letras, números, `-`, `_`; sem barra, espaço ou caractere especial).
- **`requestHash` calculado no servidor** (JSON canônico com ordem de chaves estável). **Mesma chave + mesmo pedido → retorna o resultado anterior**; **mesma chave + pedido diferente → conflito** (`already-exists`/`failed-precondition`).
- **`serviceId` no formato `svc_{UUIDv4}`**, criado **uma única vez** ao adicionar o serviço à rota, estável ao reordenar/editar, **nunca** derivado do índice visual e **nunca** regenerado no `confirmRoute`. Regex: `^svc_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`.
- **`routeId` e `serviceId` são validados** (tipo, tamanho, ausência de barra) **antes de formar caminhos** determinísticos (`rt_{routeId}_{serviceId}`, `pay_{routeId}_{serviceId}`, `inc_pay_{routeId}_{serviceId}`).
- **`confirmRoute` usa `confirmationHash`** (servidor) para detectar payload diferente sob os mesmos ids: **IDs determinísticos sozinhos não substituem a comparação do hash**.

### Estado de implementação

- Decisão **aprovada**. Nenhuma dessas Functions, ids ou hashes existe ainda no código.

### Consequências

- Reenvio e duplo clique são seguros; auditoria completa; nada é editado ou apagado.

---

## DEC-017 — Construção paralela e cutover único

**Status:** Aprovada (desenho) — cutover e reset não executados
**Data:** 30/08/2026

### Decisão

- O **novo núcleo financeiro é construído em paralelo** (`shared/currency`, `customers`, `receivables`, `payments`, `income`, Cloud Functions, regras e testes), **sem nenhuma ligação parcial com o painel legado**.
- **Nenhum sistema financeiro híbrido na interface**: não substituir só `clientes[]` deixando contas/recebimentos ainda locais.
- **Sem migração dos dados fictícios atuais.**
- **Cutover único e controlado**, na ordem:
  1. **dry-run** do reset fictício;
  2. **relatório** do que seria apagado;
  3. **autorização** explícita;
  4. **reset** dos dados fictícios;
  5. **ativação das novas bridges**;
  6. **remoção do `localStorage` financeiro**.
- **Nenhuma escrita direta do cliente em `incomeEntries`** — apenas leitura (todas as escritas por Functions/Admin).

### Estado de implementação

- Decisão **aprovada**. **O reset dos dados fictícios ainda não foi executado**; nenhuma bridge nova foi ativada; o `localStorage` financeiro segue em uso pelo painel legado. O cutover será uma etapa própria, autorizada, com dry-run e confirmação.

### Consequências

- Transição de percepção atômica; risco isolado; possibilidade de rollback antes do cutover.

---

## DEC-018 — Política online, confirmação do servidor e sincronização

**Status:** Aprovada (desenho) — implementação e App Check não configurados
**Data:** 30/08/2026

### Decisão

- **Toda gravação financeira exige confirmação do servidor** antes de exibir sucesso.
- **Callables financeiras são online-only.** **Entradas manuais também são online-only.**
- **CRUD de clientes** pode continuar direto no Firestore, mas **só mostra sucesso após o acknowledgement do servidor**.
- **Estados de sincronização visíveis:** `salvando`, `salvo`, `offline`, `erro`.
- **Dados pendentes nunca entram no faturamento definitivo** (o `onSnapshot` ignora `metadata.hasPendingWrites` e leituras `fromCache` em totais definitivos).
- **Fuso oficial do MVP: `America/Sao_Paulo`.**
- **A data de reversão** (`reversePayment`/`reverseManualIncome`) é **calculada pelo servidor no dia real do estorno** (America/Sao_Paulo); **o cliente não escolhe nem adultera** essa data. `createdAt` sempre `serverTimestamp`. Correção retroativa será decisão separada.
- **App Check obrigatório antes de usuários reais.** As Functions de segunda geração usarão **`enforceAppCheck: true`** quando a etapa for autorizada.
- **Leituras podem usar cache** com indicação de estado, mas **cache não é confirmação financeira**.

### Estado de implementação

- Decisão **aprovada**. **App Check ainda não está configurado**; os estados de sincronização e as callables **ainda não existem**; nada foi publicado. O comportamento atual do painel permanece inalterado até o cutover (DEC-017).

### Consequências

- Faturamento nunca conta escrita pendente; convergência celular↔computador via Firestore + listeners.

---

## DEC-019 — Compartilhamento do núcleo financeiro entre web e servidor por bundle

**Status:** Aprovada como desenho — implementação ainda não iniciada
**Data:** 31/08/2026

### Contexto

O núcleo financeiro puro (moeda, validações, entidades, invariantes, FIFO) vive em `src/` e é usado pelo web. As futuras Cloud Functions precisarão usar **exatamente** o mesmo núcleo. É proibido: cópia manual das regras em `functions/`, duas implementações de FIFO, import relativo que resolva localmente mas fique fora do pacote de deploy, domínio dependente de Firebase, servidor no bundle do navegador, e código financeiro divergente entre web e Functions.

### Decisão principal

- O **núcleo financeiro puro continua com uma única fonte em `src/`** (`src/shared/currency`, `src/shared/validation`, `src/features/*/domain` e, futuramente, `src/features/*/application`).
- **Cloud Functions ficam em `functions/`** com `package.json`, `package-lock.json` e build próprios.
- As Functions **importam o domínio/application compartilhados do `src` raiz durante o build**; o **esbuild incorpora** esse código ao artefato **`functions/lib/index.js`**.
- O **deploy nunca depende de import relativo para arquivo que permaneça fora do diretório enviado**: o núcleo está no artefato porque foi **inlinado no bundle**, não porque o Firebase CLI seguiria imports fora de `functions/`.
- **`firebase-admin` e `firebase-functions` permanecem dependências externas** instaladas pelo `functions/package.json`.
- **Não usar npm workspaces agora.**
- **Não duplicar** domínio, invariantes, moeda, validações ou FIFO dentro de `functions/`.
- **Não realizar agora** a reestruturação completa `apps/web + apps/functions + packages/core`.

### 1. Caminhos

- De **`functions/src/index.ts` até o `src` raiz**, o caminho relativo correto começa por **`../../src/`** (subir de `functions/src/` para a raiz e então entrar em `src/`). **`../src/` NÃO é o caminho correto do handler.**
- Handlers em subpastas (ex.: `functions/src/infrastructure/…`) usarão mais um nível (`../../../src/`). Os imports exatos dependem do módulo consumido, mas **devem resolver em typecheck, bundle, testes e Emulator**.

### 2. Separação da camada application (cliente ≠ servidor)

**Compartilhado (shared):** `domain`, `Cents`, validações, `allocateFIFO`, e contratos/DTOs **realmente neutros**.

**Servidor (executado SOMENTE pelas Functions):** casos de uso financeiros **autoritativos** — `recordClientPayment`, `confirmRoute`, `cancelRoute`, `reversePayment`, `cancelReceivable`, `createManualIncome`, `reverseManualIncome` — e as **ports de persistência transacional**.

**Web:**
- **não executa FIFO como autoridade financeira**;
- **não atualiza `paidCents`/`status` diretamente**;
- usa **gateways callable** para comandos financeiros;
- usa **repositories somente de leitura** para `payments`, `receivables` e `incomeEntries`;
- **pode** usar repository direto para **CRUD de clientes** (conforme DEC-015/DEC-018);
- recebe atualizações por **listeners** depois da confirmação do servidor.

Web e servidor **NÃO** executam os mesmos casos de uso privilegiados.

### Direção das dependências

O **fluxo em execução** (chamadas em runtime) e a **dependência do código** (quem importa quem) são coisas distintas e ficam registrados separadamente. Em particular, `domain` **nunca** importa infrastructure, admin repository nem Firebase — o domínio é invocado pela application, não o contrário.

**FLUXO EM EXECUÇÃO NO SERVIDOR:**

```
functions handler
  → server application use case
  → repository port
  → admin repository implementation
  → Firestore
```

**DEPENDÊNCIA DO CÓDIGO (servidor):**

- `functions handler` importa `server application`;
- `server application` importa `domain` e as interfaces de ports;
- as **interfaces dos ports pertencem à camada application**;
- `infrastructure/admin` **implementa** os ports e pode importar application contracts e domain;
- o **composition root** cria os adapters e os **injeta** nos casos de uso;
- `domain` importa **somente módulos puros compartilhados**;
- `domain` **nunca** importa application, infrastructure, `firebase-admin` ou handlers.

**FLUXO EM EXECUÇÃO NA WEB:**

```
presentation
  → client application use case
  → callable/read repository port
  → Firebase Web adapter
```

**DEPENDÊNCIA DO CÓDIGO (web):**

- `presentation` importa `client application`;
- `client application` importa `domain`/contracts e as interfaces de ports;
- `Firebase Web infrastructure` **implementa** os ports;
- o **composition root** injeta os adapters;
- `application` **não** importa Firebase Web diretamente.

### 3. Organização futura sugerida (não obrigatória agora)

Dentro de cada feature poderá existir:

```
application/
├── contracts/
├── client/
│   ├── ports/
│   └── use-cases/
└── server/
    ├── ports/
    └── use-cases/
```

Não é obrigatório criar esta árvore agora, mas **esta decisão impede que um caso de uso privilegiado seja executado no cliente**.

### 4. TypeScript das Functions

- `functions/tsconfig.json` será **independente** (contexto Node) e **não** incluirá indiscriminadamente todo `../src`.
- Tipará somente: `functions/src/**/*.ts`; os módulos compartilhados **efetivamente importados**; `application/server` efetivamente importado; e o `domain`/`shared` necessários.
- Usará **`noEmit`** para typecheck (o esbuild é responsável pela emissão).
- **Não incluir:** `presentation`, login, notificações DOM, painel legado, adapters web, nem arquivos de teste no bundle.

### 5. esbuild (configuração futura explícita)

- `bundle: true`; `platform: 'node'`; `target: 'node22'`;
- entrypoint: `functions/src/index.ts`; outfile: `functions/lib/index.js`;
- `sourcemap` apropriado; **tree shaking** habilitado;
- **formato CJS ou ESM definido de forma coerente com `functions/package.json`** — a escolha final CJS×ESM será **confirmada na implementação do scaffold, não presumida**;
- `main` do `functions/package.json` apontando para `lib/index.js`.
- **Externals** devem cobrir pacotes e subpaths: `firebase-admin`, `firebase-admin/*`, `firebase-functions`, `firebase-functions/*`. Alternativamente, `packages: 'external'` **poderá** ser adotado se for verificado que não externaliza algo que **deveria** entrar no bundle (ex.: o núcleo de `src/`).

### 6. Empacotamento e deploy

- `firebase.json` futuramente terá: `source: functions`; **codebase próprio**; **runtime Node 22**; `predeploy` executando o build.
- **Somente `functions/`** é enviado como código-fonte da Function; o núcleo estará presente **por estar incorporado no bundle**, não por o CLI seguir imports fora de `functions/`.
- `functions/lib` e `functions/node_modules` **não serão versionados**.
- **Nenhum deploy** será realizado na etapa de scaffold sem autorização separada.

### 7. Mapeadores (três níveis)

- **domínio compartilhado** (único, com as regras/invariantes);
- **representação persistida plana e neutra** quando for realmente útil;
- **conversores específicos:** Firebase **Web** Timestamp ↔ representação neutra; Firebase **Admin** Timestamp ↔ representação neutra.

**Nenhum mapper puro importará simultaneamente Firebase Web e Firebase Admin.** Não existe um único mapper Firebase compartilhado integralmente entre web e Admin. Regras financeiras e invariantes **continuam únicas no domínio**.

### 8. Runtime

- **Node local atual: 24**, usado para **tooling** (firebase-tools/esbuild).
- **Runtime futuro das Functions: Node 22.**
- `functions/package.json` e `firebase.json` deverão ser **coerentes com Node 22**.
- Possíveis **avisos de `engines`** durante instalação local no Node 24 deverão ser **analisados, não escondidos**.
- **Confirmar o suporte oficial de runtimes novamente** antes da implementação e antes do deploy.

### 9. Testes futuros (separados)

- **Vitest:** domínio e application puros.
- **Repositórios fake:** application (ports implementadas em memória).
- **Emulator de Functions:** handlers e transações.
- **Emulator de Firestore:** Rules e isolamento por `uid`.
- **Auditoria do metafile do esbuild:** confirmar que o domínio/application necessários **entraram** no bundle e que `presentation`/Firebase Web **não** entraram.

### 10. Alternativas rejeitadas / adiadas

- **Import externo cru sem bundler:** **rejeitado** (o CLI não sobe arquivos fora de `functions/`; falharia em runtime).
- **Duplicação do núcleo em `functions/`:** **rejeitada** (divergência financeira).
- **npm workspaces agora:** **adiado** por custo e risco.
- **Reestruturação completa agora:** **adiada** por risco de regressão sobre o app que já funciona.

### 11. Estado de implementação

- `functions/` **ainda não existe**;
- **esbuild ainda não foi instalado**;
- `firebase.json` **ainda não possui** blocos `functions`/`emulators`;
- **Node 22 ainda não foi configurado**;
- **nenhum callable existe**;
- **nenhum Emulator foi configurado**;
- **nenhum deploy foi realizado**;
- **DEC-019 apenas aprova a estratégia.**

### Consequências

- Fonte única do núcleo financeiro garantida entre web e servidor, com presença garantida no artefato de deploy via bundle.
- As próximas etapas (scaffold de `functions/`, application client/server, infra, callables, Emulator/Rules) serão autorizadas separadamente.

---

## DEC-020 — Tabela de deslocamento sincronizada, versionada, imutável e com busca multiprovedor

**Status:** Aprovada como desenho — implementação não iniciada
**Data:** 01/09/2026

### Contexto

O motoboy precisa de uma **Tabela de deslocamento** (bairro/área/condomínio/empresa/ponto de referência → valor da entrega) que ele mesmo mantém, inclusive **colando uma lista inteira recebida por WhatsApp**. O protótipo atual (WIP não commitado em `index.html` e `src/legacy/panel.js`) guarda isso no `localStorage`, dentro do legado, com dinheiro em float e sem sincronização — **contraria DEC-010 e DEC-013** e **não é aprovado para commit**. Esta decisão define o desenho definitivo. Reafirma o escopo do produto: **não há solicitações externas de clientes, não há carteira, não há transferência nem movimentação de dinheiro; clientes são referências internas; Pix futuro apenas reconhecerá recebimentos e NÃO faz parte desta DEC; a tabela apenas sugere valores para os registros do motoboy; a corrida confirmada guarda um snapshot imutável do valor usado.**

### Decisão

Criar a feature limpa `pricing` (Clean Architecture) com **Firestore como fonte oficial isolada por uid**, **versões publicadas imutáveis** com **ponteiro ativo** e **histórico de ativações**, **toda escrita feita exclusivamente por Cloud Functions autoritativas** (a web só lê e chama gateways callable), **importação por substituição completa** com prévia e conflitos resolvidos por humano, **parser determinístico**, **valores em centavos** (`shared/currency`), **snapshot de preço nas corridas confirmadas** e **busca de endereços multiprovedor** por uma abstração neutra. Sem globals em `window`; sem regra de negócio no legado (DEC-010); sem float (DEC-013).

### 1. Escrita somente pelo servidor

A aplicação web **lê** a tabela ativa, recebe atualizações por **`onSnapshot`** e chama **gateways callable** — **nunca escreve diretamente** em `pricingTables`, `pricingConfig` ou `pricingTableActivations`. **Cadastro, edição, exclusão, importação, publicação e reativação passam pelas Functions.** As Rules futuras permitirão **leitura apenas ao proprietário autenticado e verificado** e **bloquearão toda escrita direta do cliente** (`allow write: if false;`); **Functions/Admin SDK serão a única autoridade de escrita**.

### 2. Modelo de dados (isolado por uid)

Domínio `PricingArea`, exibido como "Bairro, área ou ponto de referência":
```
PricingArea {
  id: string;                 // areaId — identidade oficial, ESTÁVEL entre versões
  displayName: string;
  nameNormalized: string;     // busca/dedupe — NUNCA identidade
  aliases: string[];          // normalizados; NUNCA criados automaticamente
  type?: 'bairro'|'area'|'condominio'|'empresa'|'ponto_referencia';
  amountCents: int > 0;       // shared/currency, nunca float
}
```
Firestore:
- `users/{uid}/pricingTables/{versionId}` → `{ createdAt(server), source:'paste'|'manual', itemCount, status:'published', publishedBy }` — **imutável após publicada** (sem `update`/`delete`, sem `updatedAt`).
- `users/{uid}/pricingTables/{versionId}/areas/{areaId}` → `PricingArea` (imutável dentro da versão).
- `users/{uid}/pricingConfig/active` → `{ activeVersionId, revision, updatedAt(server) }`.
- `users/{uid}/pricingTableActivations/{activationId}` → `{ versionId, activatedBy, activatedAt(server), operation:'publish'|'reactivate', previousVersionId }`.

**Limites explícitos e testados** (valores exatos definidos no domínio na implementação): `MAX_PRICING_AREAS = 300`; tamanho máximo de `displayName`; quantidade e tamanho de `aliases`; tamanho máximo do texto importado; tamanho de `note`; tipos/formatos aceitos. Justificativa do 300: a tabela real tem poucas dezenas de itens; mantém a operação abaixo dos limites transacionais; limita payload e abuso; mantém validação e latência previsíveis.

### 3. Publicação atômica (`publishPricingTable`)

Callable autoritativa que executa em **uma única transação**:
- valida **auth, e-mail verificado e App Check** (quando habilitado);
- lê `pricingConfig/active`; confere **`expectedActiveVersionId`** e **`expectedRevision`**;
- **valida integralmente** o payload (tipos, `amountCents` inteiro > 0, limites, duplicidades, aliases, conflitos);
- cria o documento da **versão**; cria **todos** os documentos de **áreas**; cria o registro de **ativação**;
- **atualiza o ponteiro ativo e incrementa `revision`**; confirma tudo **atomicamente**.

**Nenhuma versão pode ficar ativa parcialmente.** Internamente usa transação/batch no Admin SDK. Justificativa (transação, não batch client-side): há invariantes que o cliente não garante (validação integral + troca controlada do ponteiro + concorrência) → operação privilegiada de servidor (coerente com DEC-015/DEC-019).

### 4. Idempotência

`publishPricingTable` recebe **`idempotencyKey`, `requestHash`, `expectedActiveVersionId`, `expectedRevision`, tabela completa**. Regras:
- `idempotencyKey` validada (formato); `versionId` **determinístico** a partir dela **ou** registro idempotente equivalente;
- **mesma chave + mesmo `requestHash`** → retorna o **resultado durável anterior**;
- **mesma chave + `requestHash` diferente** → **rejeita conflito**;
- **duplo clique / retry de rede não pode criar duas versões**.
`reactivatePricingTable` também é **idempotente**.

### 5. Concorrência

Se `revision` ou `activeVersionId` mudou desde a leitura do cliente → **rejeitar `CONCURRENT_MODIFICATION`**, **sem publicar parcialmente**. O cliente recarrega a versão ativa, **recalcula o diff** e **reapresenta** as mudanças ao usuário.

### 6. Importação (primeiro escopo) — substituição completa

Somente **SUBSTITUIR a tabela ativa por uma nova versão completa** (sem "mesclar"). A prévia mostra: **novos, alterados, removidos, inalterados, duplicados, ambíguos, conflitos e linhas não interpretadas (`unparsed`)**. **Nada é publicado enquanto houver conflito ou linha não resolvida.** Mesclagem/incremental **adiada** para decisão futura.

### 7. Parser determinístico (puro)

`parseDeslocamento(raw)` — sem DOM/Firebase; **nenhuma linha descartada em silêncio**.
- **Cabeçalho de preço** (define o grupo seguinte): linha que, sem emojis/marcadores/espaços, é só um token monetário — contém `R$` (`R$12,00`, `R$ 15,00`, `R$20`) **ou** decimal com vírgula (`25,00`, `12,50`). Aceita emojis coloridos antes (🟩), marcadores `•`,`*`,`-`,`–`, separador `⸻`, espaços irregulares.
- **Inteiro isolado sem `R$` e sem decimais** (`20`, `060`) → **`AMBIGUOUS` para revisão**, nunca preço.
- **Preço inline** só com **marcador monetário inequívoco** (`R$`, ou separador `—`/`:`/`|` seguido de token monetário): `Kowalski — R$ 20,00`, `Kowalski: R$20`, `Kowalski | R$ 20,00`. **Inteiro no fim sem marcador NÃO é preço:** `Kowalski 20`, `Décio 060`, `BR-153` permanecem nome.
- **`AMBIGUOUS_GROUPING`** apenas em **padrões claros de agrupamento**: `I e II`, `1 e 2`, `I/II`, `1/2`, `Bloco A e B`, `Flamboyant I e II`. **Nomes comuns com "e" não são bloqueados automaticamente.**
- **`CONFLICT`/`POSSIBLE_ALIAS`**: ex.: "Milhão (antiga Kowalski)" R$15 × "Kowalski" R$20 → **nunca unir sozinho**; revisão humana.
- `DUPLICATE_IN_PASTE`, `INVALID_PRICE`, `NO_PRICE`; linhas não classificadas → `unparsed[]`.

### 8. Identidade estável e reaproveitamento de `areaId`

`areaId` é estável quando representa a **mesma área**; `nameNormalized`, alias e Photon **não** são identidade; renomear **não** cria novo id automaticamente; **conflito → o usuário decide**; área realmente nova → novo id. **Importador:** carrega os `areas` da versão ativa; para cada item colado (normalizado) — **match único** → reusa `areaId` (valor diferente = `CHANGED`); **sem match** → NEW (id novo na publicação); **match incerto** (bate alias de uma área e nome de outra, ou várias) → **`CONFLICT`**: a revisão pergunta "manter o mesmo item (reusa `areaId`) ou criar novo?".

### 9. Versões imutáveis + cadastro individual versionado

- Versão publicada **nunca** recebe `update`/`delete`; itens publicados **nunca** recebem `update`/`delete`.
- **Edição individual cria nova versão completa**; **exclusão individual apenas omite** o item da nova versão (não apaga do histórico).
- **Desfazer reativa** uma versão anterior **sem alterar seu conteúdo**, pela mesma operação autoritativa, registrando nova ativação (`operation:'reactivate'`), com controle de concorrência. `areaId` permanece estável para a mesma área.

### 10. Sincronização / leitura em tempo real

Listener no **ponteiro** `pricingConfig/active` + listener nos **`areas` da versão ativa**. Ao mudar `activeVersionId`: **cancelar o listener da versão anterior → estado `carregando` → assinar os itens da nova versão → só então revelar** — **nunca misturar itens de duas versões**; **cancelar todos os listeners no logout**.

### 11. Estados de sincronização (escritas por callable)

- **`salvando`** começa **antes** da chamada; **`salvo`** somente após **acknowledgement durável da Function**; **`erro`** quando a callable rejeita; **`offline`** quando a operação não chega ao servidor.
- **Não** usar `metadata.hasPendingWrites` como confirmação de escrita da callable (o cliente não faz a escrita Firestore local). `fromCache` serve **apenas** para informar o estado das **leituras/listeners**.

### 12. Vínculo área × corrida e "sem preço antigo"

Estado por entrega: `pricing = { source:'none'|'table'|'manual_override', areaId?, displayName?, amountCents?, tableVersionId? }`.
- **Match** → `source='table'`, valor da área, indicação visual da área reconhecida e da origem "tabela".
- **Trocar/editar o texto do endereço** → **limpar** `pricing` (nunca reaproveitar o preço anterior).
- **Sem match** → limpar o automático anterior, valor **vazio**, permitir manual e **seleção manual** de área.
- **Ajuste manual** → `source='manual_override'`, preserva o valor.
- **Snapshot na corrida confirmada:** `{ pricingAreaId, displayName, amountCents, source:'table'|'manual_override', tableVersionId }` — imutável; alterar/excluir/publicar **não** muda o histórico.

### 13. Busca de endereços multiprovedor (somente desenho nesta DEC)

Abstração neutra (apresentação e regras de pricing **não conhecem** o formato dos provedores):
```
interface AddressSearchProvider { search(query, context): Promise<AddressSuggestion[]>; }
interface AddressSuggestion { provider:'google'|'photon'; providerPlaceId:string; displayText:string;
  street?; houseNumber?; district?; locality?; city?; state?; countryCode:string; latitude?; longitude?; }
```
Implementações previstas: `GooglePlacesAddressProvider`, `PhotonAddressProvider`, `ResilientAddressSearchService`. Níveis: **Google Places Autocomplete (New) principal → Photon fallback → digitação manual (garantia final)**. `providerPlaceId` **nunca** é `PricingArea.id`; ID Google ≠ ID Photon; Photon/Google **nunca** são identidade da área; vínculo com `PricingArea` pelos campos **normalizados** e, na incerteza, **escolha humana**. Respostas atrasadas **ignoradas** (por `requestId`/`AbortController`); **fallback não apaga o texto**; **Google e Photon não são consultados simultaneamente a cada tecla** (Google primeiro; Photon só pela política de fallback: rede/timeout/429/5xx/indisponibilidade/quota/sem resultado útil/Google não configurado); **circuit breaker** simples; logar só provedor/duração/status/tipo de falha (**nunca** o endereço).

Implementação futura do **Google** exigirá: **billing habilitado**; **chave web restrita por domínio e por API**; **session tokens**; **field masks mínimos**; `includedRegionCodes:['br']`; `regionCode:'br'`; `languageCode:'pt-BR'`; `locationBias` (não `locationRestriction` por padrão); **debounce e cancelamento**; **alertas de orçamento**; revisão das **políticas de armazenamento e atribuição** (não guardar payload completo; Place ID separado quando necessário, sem substituir o snapshot). **Photon** usará **`countrycode=BR`**, `lang=pt`, `lat`/`lon` como preferência regional, `bbox` só para restrição rígida, timeout e cancelamento próprios. A chave do navegador **não é segredo** — deve estar restrita. **App Check com `enforceAppCheck: true` será obrigatório antes do deploy para usuários reais.** A implementação do Google e a correção do Photon ficam em **etapa/commit próprios**. Não instalar Google agora, não criar chave, não alterar `.env`/`.env.example`, não implementar providers.

### 14. Segurança

Rules futuras (etapa própria, apresentar antes): **leitura só do dono autenticado e verificado**; **escrita direta do cliente bloqueada** (`allow write: if false;`) em `pricingTables/**`, `pricingConfig/**`, `pricingTableActivations/**`. Validações de integridade (tipos, `amountCents` int>0, limites, imutabilidade) ocorrem nas Functions. App Check antes de produção. Sem globals em `window`; sem regra no legado (DEC-010); sem float (DEC-013).

### 15. Escopo do produto (reafirmação)

Não existem solicitações externas de clientes; não existe carteira; não existe transferência/movimentação de dinheiro; clientes são referências internas; Pix futuro apenas **reconhece** recebimentos e **não faz parte da DEC-020**; a tabela apenas **sugere** valores para os registros do motoboy; a corrida confirmada guarda **snapshot imutável** do valor usado.

### 16. Plano de etapas (cada uma exige autorização própria)

1. Corrigenda + aprovação e **registro desta DEC-020** (docs). 2. Domínio puro (`PricingArea`, normalização, matching) + testes. 3. Parser puro + diff + testes. 4. Application ports/use-cases + repositório fake + testes. 5. **Scaffold das Functions** (DEC-019). 6. **Callables autoritativas** `publishPricingTable`/`reactivatePricingTable` (idempotência, concorrência, validação, ativações). 7. Repositório web **só-leitura** + **gateway callable**. 8. UI colar → revisar → resolver → publicar → desfazer (estados de sync). 9. **Cutover:** remoção do protótipo `localStorage` do legado. 10. Integração com entregas + snapshot. 11. **Correção separada da busca** (abstração multiprovedor; Google + Photon). 12. **Rules, Emulator, App Check e deploy** — somente mediante autorizações específicas.

### Estado de implementação

- **Decisão aprovada como desenho; implementação não iniciada.**
- **O WIP atual (`index.html`, `src/legacy/panel.js`) NÃO está aprovado para commit** (será refeito/removido no cutover).
- **Functions não implementadas; Google não habilitado; nenhuma chave criada; Rules não alteradas; nenhum deploy; nenhuma migração de dados.**

### Consequências

- Tabela igual em celular e computador, versionada, imutável e auditável, com publicação atômica e idempotente pelo servidor.
- A qualidade do reconhecimento de área/endereço dependerá da habilitação futura do Google Places (billing/chave/App Check), com fallback Photon e garantia manual.
- As etapas seguintes serão autorizadas uma a uma.

---

## DEC-022 — Separação entre persistência local e sincronização remota no bootstrap

**Status:** Aprovada e implementada
**Data:** 14/09/2026

### Contexto

O painel legado (`panel.js`) inicializa lendo `localStorage` e, ao final de `bootstrapPanel()`, chama `saveLocalState()` que escrevia de volta no localStorage E chamava `saveClientsToFirestore()` e `saveMotoToFirestore()`. Isso criava um race condition: dados potencialmente antigos eram gravados no Firestore antes da leitura remota completar. O `saveClientsToFirestore()` não possuía guarda (diferente de `saveMotoToFirestore()` que já tinha `motoRemoteLoaded`), permitindo que dados antigos de clientes sobrescrevessem dados atuais do Firestore. Além disso, `loadPaymentsIntoPanel`, `loadIncomeIntoPanel` e `loadReceivablesIntoPanel` eram chamadas no boot mas o painel legado não consumia seus resultados (não possuía `__applyRemote*` correspondentes).

### Decisão

- `saveLocalState()` escreve **exclusivamente** no localStorage. Não há chamadas automáticas ao Firestore dentro dela.
- Sincronização Firestore (`saveClientsToFirestore`, `saveMotoToFirestore`) ocorre **somente após mutações reais do usuário**, por meio de `syncClientsToFirestore()` e `syncMotoToFirestore()`.
- Ambas as funções de sync possuem guarda: só executam após a hidratação individual respectiva.
- **Hidratação individual** para clientes (`__hydrateClientes`) e moto (`__hydrateMoto`): funções dedicadas no painel legado que recebem dados remotos, mesclam com o estado local (preservando dados financeiros legados) e marcam a hidratação como concluída.
- `main.ts` orquestra a hidratação com `Promise.allSettled`, aguardando todas as cargas antes de chamar as funções de hidratação.
- Loaders das bridges retornam `LoadResult<T>` (sucesso com dados, ou erro propagado). Erro capturado **não** é considerado carregamento concluído.
- `saveLocalState()` é removida do final de `bootstrapPanel()`.
- Removidos do boot: `loadPaymentsIntoPanel`, `loadIncomeIntoPanel`, `loadReceivablesIntoPanel` (o painel não consome seus resultados).
- Merge financeiro de clientes preserva `contas`, `recebimentos` e `pendente` do estado local quando o nome do cliente coincide com o remoto.

### Consequências

- Dados antigos do localStorage não podem mais sobrescrever dados atuais do Firestore durante o bootstrap.
- Sincronização Firestore só ocorre após hidratação + mutação real do usuário.
- Comportamento offline preservado: cache local continua funcionando; sincronização remota é desbloqueada pela hidratação.
- `__applyRemoteMoto` e `__applyRemoteClientes` não chamam `saveLocalState()` — a persistência é feita pelas funções de hidratação.
- Nenhuma alteração de schema, rules, Functions, deploy ou contratos públicos.

### Arquivos alterados

- `src/legacy/panel.js` — saveLocalState(), hidratação, guards, sync explícito
- `src/main.ts` — orquestração de hidratação, imports, tipagem
- `src/features/abastecimentos/presentation/panel-bridge.ts` — LoadResult
- `src/features/manutencoes/presentation/panel-bridge.ts` — LoadResult
- `src/features/faturamento/presentation/panel-bridge.ts` — LoadResult
- `src/features/rotas/presentation/panel-bridge.ts` — LoadResult
- `src/features/customers/presentation/panel-bridge.ts` — LoadResult, retorno de dados
- `src/features/moto/presentation/panel-bridge.ts` — LoadResult, retorno de dados
- `src/features/payments/presentation/panel-bridge.ts` — remoção de loadPaymentsIntoPanel
- `src/features/income/presentation/panel-bridge.ts` — remoção de loadIncomeIntoPanel
- `src/features/receivables/presentation/panel-bridge.ts` — remoção de loadReceivablesIntoPanel