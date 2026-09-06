# Próxima etapa — modelo de tarefa

> Preencha um bloco por etapa. Uma etapa = um micro-passo autorizado = um commit.
> Copie este modelo, não o apague. Sem autorização explícita, não altere arquivos.

## Situação

- **DEC-020.3B-2A/2B/2C — CONCLUÍDAS** (commits `48fe21b`, `5591fe4`, `c1bf21b`).
- **DEC-019.1 — CONCLUÍDA** (scaffold `functions/`, Node 22 + esbuild; commit `050b9b7`).
- **DEC-019.2 — CONCLUÍDA** (`publishPricingTable` server-side; ports + fakes + SHA-256; commit `e0c248b`).
- **DEC-019.3A — CANDIDATA (ainda NÃO autorizada).** Adapter **Admin/Firestore transacional** das ports + **mapeadores estritos** + **testes no Emulator**. **Sem callable, Rules, App Check, UI, deploy ou Firebase real.** Só desenho abaixo; aguarda autorização explícita.

## Auditoria do tooling Firebase (existente)

- `.firebaserc`: projeto default `motoboys-29310`. `firebase.json`: `firestore` (db `(default)`, `southamerica-east1`, `firestore.rules`, `firestore.indexes.json`) + `functions` (source `functions`, codebase `default`, `nodejs22`, predeploy build). **Não há bloco `emulators`** → a DEC-019.3A o adiciona (mínimo, só Firestore).
- `firestore.rules`: isolamento por dono — `users/{uid}` e toda a subárvore só do dono; demais negados. O modelo desta etapa vive **sob `users/{uid}`**. O **Admin SDK ignora Rules** (autoridade de servidor), então Rules/App Check ficam fora daqui.

---

## Identificação (candidata — NÃO autorizada)

- **Etapa:** DEC-019.3A — adapter Admin/Firestore transacional + mapeadores + testes no Emulator
- **Depende de:** DEC-019.2 (ports) e DEC-020 §2/§3/§4 (modelo, publicação atômica, idempotência).
- **Autorizada em:** _(pendente — não iniciar)_ — implementar somente após autorização explícita.

## Paths Firestore (exatos, sob `users/{uid}`)

- **Config ativa:** `users/{uid}/pricingConfig/active` → `{ activeVersionId: string|null, revision: int>=0, updatedAt: serverTimestamp }`.
- **Versões imutáveis:** `users/{uid}/pricingTables/{versionId}` → `{ createdAt: serverTimestamp, source:'paste', itemCount:int, status:'published', publishedBy: uid, previousVersionId: string|null }`. Sem `update`/`delete`.
- **Áreas (imutáveis na versão):** `users/{uid}/pricingTables/{versionId}/areas/{areaId}` → `PricingArea` (`displayName`, `nameNormalized`, `aliases[]`, `amountCents:int>0`, `type?`).
- **Ativações + ledger de idempotência (mesmo doc, imutável):** `users/{uid}/pricingTableActivations/pub_{idempotencyKey}` → `{ versionId, revision:int, activatedBy: uid, activatedAt: serverTimestamp, operation:'publish', previousVersionId: string|null, requestHash: string(sha256) }`. O `activationId` é **`pub_{idempotencyKey}`** (determinístico): a ativação **é** o registro de idempotência — não há coleção `pricingIdempotency` separada.

## Escopo candidato (a confirmar) — `functions/src/pricing/firestore/…`

- **Adapters:** `PricingActiveTableReaderAdmin` (lê `pricingConfig/active` + `areas` da versão ativa por `uid`); `PricingPublishTransactionAdmin` (uma **transação Admin**: 1) lê **`pricingTableActivations/pub_{idempotencyKey}` ANTES do ponteiro ativo** — se existir: mesmo `requestHash` → devolve o resultado gravado (`idempotentReplay:true`); `requestHash` diferente → conflito (`REQUEST_HASH_MISMATCH`); 2) só então lê `pricingConfig/active` e confere `expectedActiveVersionId`/`expectedRevision`; 3) cria versão + áreas + a ativação `pub_{idempotencyKey}` e troca o ponteiro incrementando `revision` — **tudo-ou-nada**, dentro do limite de operações). `versionId` determinístico (`ver_{idempotencyKey}`) e `PricingIdGeneratorAdmin` determinístico por semente — retries não geram ids diferentes nem versões/áreas duplicadas.
- **Mapeadores estritos** (`mappers.ts`): domínio↔doc **sem defaults silenciosos** — validam tipos, `amountCents` inteiro, `aliases` canônicos; **rejeitam** (erro) campo ausente/!=esperado; nunca coagem/inventam. Round-trip fiel.
- **Paths** (`paths.ts`): construtores dos caminhos acima (uid saneado).
- **Emulator reproduzível:** bloco `emulators.firestore` (host/porta) no `firebase.json`; projeto de teste determinístico (ex.: `demo-motoboy`); `FIRESTORE_EMULATOR_HOST`; script `test:emulator` via `firebase emulators:exec --only firestore`. **Isolado** do `check` padrão (Emulator/Java pode faltar).
- **Barrel** do server exporta os adapters (não os fakes).
- **NÃO tocar:** handler callable, `firestore.rules`, `firestore.indexes.json`, App Check, deploy, `src/` (só importado), `docs/architecture`, `package*` da raiz.

## Contrato / critérios

- Adapters implementam **exatamente** as ports da DEC-019.2 (intercambiáveis com os fakes); o use-case `publishPricingTable` **não muda**.
- **Idempotência antes da concorrência** no adapter real; `requestHash` SHA-256 persistido (nunca o JSON); retries → mesma versão/ids.
- Escrita **só** por transação Admin; **nenhuma** escrita parcial; versões/áreas/ativações **imutáveis** (sem update/delete); isolamento por `uid`.
- Emulator isolado e reproduzível; suíte web (raiz) segue **20/397**; `functions` typecheck/build/auditoria verdes; testes Emulator num script próprio que **não quebra** o `check` quando o Emulator não está disponível (documentar pré-requisito Java/CLI).

## Testes obrigatórios (Emulator)

1. **Primeira publicação:** vazio → versão, ponteiro `activeVersionId`/`revision=1`, áreas gravadas, ativação `pub_{key}` (com `requestHash`).
2. **Nova versão:** versão anterior→nova com `previousVersionId`, ponteiro/`revision` avançam; versão anterior e suas áreas **intactas**.
3. **Replay (ledger antes do ponteiro):** mesma key+hash → resultado gravado na ativação `pub_{key}`; **sem** nova versão/áreas; a leitura da ativação precede a do ponteiro.
4. **Conflito de key/hash:** mesma key + hash diferente → `REQUEST_HASH_MISMATCH`, **sem** escrita.
5. **Concorrência:** `expectedRevision`/`expectedActiveVersionId` divergentes → `CONCURRENT_MODIFICATION`, **sem** escrita.
6. **Rollback:** falha no meio da transação → **nada** persiste (sem versão/áreas/ativação/ponteiro parciais).
7. **Histórico imutável:** publicar de novo **não** altera/apaga versões, áreas ou ativações anteriores.
8. **Isolamento entre 2 uid:** publicação de `uidA` não afeta `pricingConfig`/versões de `uidB` (e vice-versa).

## Fora de escopo (não fazer)

- Handler **callable**, `firestore.rules`, App Check, deploy, acesso ao **Firebase real**; `reactivatePricingTable`; UI; núcleo financeiro autoritativo; reestruturação `apps/` + `packages/core`.

## Registro arquitetural

- Nova decisão arquitetural: **Não** — a idempotência reutiliza a coleção `pricingTableActivations` já prevista na DEC-020 §2 (doc determinístico `pub_{idempotencyKey}`, imutável). Sem coleção nova; sem addendum. Se algo estrutural surgir na implementação, apresentar antes e registrar em `docs/architecture/DECISIONS.md`.
