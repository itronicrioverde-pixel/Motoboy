# Beta — roteiro manual no navegador e cobertura

Roteiro de teste manual para a preparação do beta (`review/beta-preparacao`).
Ele complementa a suíte automatizada (vitest) cobrindo o que os testes mockam:
autenticação real, Firestore real e continuidade dos dados entre celular e
computador da mesma conta.

**Escopo confirmado para o beta em 07/10/2026:** cada pessoa usará um celular
por conta, mas poderá entrar na mesma conta pelo computador e encontrar seus
dados. O teste de aceite deve comprovar a ida e a volta celular ↔ computador,
com recarga após cada gravação. Não é necessário operar dois celulares ao
mesmo tempo nem provocar escritas concorrentes entre aparelhos para liberar
este beta. As proteções de concorrência já implementadas permanecem; os
ensaios históricos abaixo não passam a ser requisito de dois celulares.

> NUNCA executar `firebase deploy` sem autorização. Estes passos usam o
> preview local (`npm run dev`) com o projeto real do `index.html`.
> A suíte rápida web ainda mocka Firebase e DOM. As suítes
> `npm run test:emulator` e `functions/test:emulator` usam o Firestore Emulator.

Para ensaio de interface sem tocar em contas reais, iniciar Auth e Firestore
Emulators com `firebase emulators:start --only auth,firestore --project demo-motoboy`
e executar o Vite com `VITE_USE_LOCAL_EMULATORS=true`,
`VITE_FIREBASE_PROJECT_ID=demo-motoboy` e as demais variáveis
`VITE_FIREBASE_*` apontando para valores fictícios desse projeto demo.
O proxy do Vite e a conexão dos SDKs só são habilitados em desenvolvimento
com `projectId` iniciado por `demo-`; não são usados no build de produção.
As contas criadas nesse ambiente são descartáveis e não substituem o teste
da mesma conta no celular e no computador, nem o isolamento entre duas contas
do projeto beta.

### Como abrir esta revisão no celular, sem deploy

1. No checkout `review/beta-preparacao`, configure `.env.local` com os seis
   valores `VITE_FIREBASE_*` do **projeto beta** indicados em `.env.example`.
   O arquivo é ignorado pelo Git; não envie seus valores no relato do teste.
   Use duas contas descartáveis A/B e confirme que pertencem ao projeto beta.
   A comprova a continuidade celular ↔ computador; B serve somente para
   verificar isolamento e pode ser acessada sequencialmente no mesmo aparelho.
2. No computador, execute `npm run dev -- --host 0.0.0.0`. Com o celular na
   mesma rede Wi-Fi, abra `http://IP-DO-COMPUTADOR:5173/` (ou a porta que o
   Vite imprimir). Use apenas a rede local de confiança e encerre o servidor
   após o ensaio. Não é necessário fazer deploy de regras ou da aplicação.
3. Execute os passos 1–4 abaixo; use B onde o roteiro pede troca de conta.
   Registre aparelho, navegador, data, número do passo, **passou/falhou** e, em falha,
   texto exibido e captura de tela. Identifique as contas como A/B; não envie
   senhas, chaves Firebase nem dados pessoais no relato.

Se a tela de login abrir mas não autenticar, confira primeiro a configuração
Firebase do projeto beta e a conectividade do celular; registre o erro antes
de alterar qualquer regra ou dado.

---

## 1. Autenticação e isolamento por UID (não coberto por teste)

| Passo | Ação | Esperado |
| --- | --- | --- |
| 1.1 | Rodar `npm run dev` e abrir o app | Tela de login aparece; painel não é revelado antes |
| 1.2 | Entrar com um e-mail/senha válido | Painel abre; nome do menu = "Painel" |
| 1.3 | Sair (menu → Sair) e entrar com OUTRO e-mail | Dados do usuário anterior SUMEM (isolamento por UID); página recarrega |
| 1.4 | Recarregar a página com a mesma sessão | Dados persistem (abastecimentos/entradas/jornada continuam) |
| 1.5 | Desligar a rede no DevTools (offline) e tentar o login | Nenhuma mensagem revela se o e-mail existe; erro genérico |
| 1.6 | Após os passos 2–3 na conta A pelo celular, entrar na mesma conta pelo computador e recarregar; conferir clientes/contas de teste, moto, abastecimentos, manutenção, entradas/faturamento e jornada/histórico que existirem; criar uma nova entrada de teste no computador e voltar ao celular para recarregar | Os dados e valores confirmados aparecem nos dois aparelhos, inclusive a nova entrada, sem duplicação; B não vê os dados de A. Não fazer gravações simultâneas |

## 2. Etapa 1 — gravação só confirmada pelo servidor

| Passo | Ação | Esperado |
| --- | --- | --- |
| 2.1 | Abastecimentos → salvar um novo | Soma só é anunciada como "salvo" DEPOIS da confirmação; sem badge permanece |
| 2.2 | Offline: salvar um abastecimento | ID, UID e payload ficam guardados antes do envio; badge **Sincronizando** → **Aguardando conexão** enquanto espera ou **Não confirmado** se a tentativa falhar. Não entra nos totais nem aparece toast de sucesso |
| 2.3 | Recarregar, voltar a rede e tocar **Tentar novamente** na lista (ou no formulário ainda aberto) | A mesma tentativa/ID/payload é reenviada; vira salva somente após confirmação, sem duplicar linha ou valor |
| 2.4 | Editar um abastecimento salvo | Janela de motivos abre; "Atualizado" só após confirmação remota |
| 2.5 | Excluir um abastecimento salvo | Some da lista só depois de o Firestore confirmar |
| 2.6 | Repetir 2.1–2.5 para Manutenção e para Entrada manual (Faturamento) | Mesmo comportamento; badge nas 3 listas |
| 2.7 | Perder somente a resposta após o commit e recarregar | A tentativa continua visível como não confirmada; retry encontra o marcador remoto e reconcilia sem novo documento |
| 2.8 | Tocar duas vezes em **Tentar novamente** | Uma única tentativa fica em voo; não há segundo lançamento nem dois toasts de sucesso |
| 2.9 | Trocar de usuário enquanto uma tentativa ainda aguarda | A conta B não vê nem confirma a tentativa da A; ao voltar à A, a tentativa e o payload permanecem disponíveis |
| 2.10 | Repetir 2.2–2.3 após reconexão do Emulator | A tentativa é confirmada uma vez; marcador e documento têm o mesmo ID/payload persistido antes da primeira tentativa |

## 3. Etapa 2 — Jornada pelo hodômetro

| Passo | Ação | Esperado |
| --- | --- | --- |
| 3.1 | Menu lateral | Não há mais "Rotas" nem "Histórico de rotas" |
| 3.2 | Dashboard → card JORNADA → "Iniciar jornada" | Abre um formulário pedindo a leitura do hodômetro; ao salvar, card mostra KM INICIAL |
| 3.3 | Avançar o km da moto (Minha Moto ou via abastecimento) | KM ATUAL da moto sobe; o card da jornada em aberto segue mostrando apenas KM INICIAL e o aviso para informar o hodômetro final |
| 3.4 | Recarregar a página | A jornada continua em aberto (persistida no Firestore) |
| 3.5 | "Iniciar jornada" com uma já em aberto | Rejeitado com aviso (uma em aberto por usuário); reenviar a MESMA leitura devolve a jornada existente |
| 3.6 | "Encerrar jornada" | Modal pede o km final; o consumo (km/L) é OBRIGATÓRIO — digitado ou o vigente da moto — e o preview mostra percurso · litros · custo; preço fica opcional; salvar → toast com o custo estimado |
| 3.7 | Conferir Faturamento | NENHUMA despesa/entrada criada com o custo estimado |
| 3.8 | Offline: iniciar jornada | Badge **Sincronizando**/**Não salvo**; "Tentar salvar novamente" reenvia a MESMA jornada sem abrir formulário; encerrar exige sincronia (aviso) |
| 3.9 | Última jornada fechada | Card mostra PERCURSO + GASOLINA ESTIMADA + CUSTO ESTIMADO + referências (km/L · R$/L) |
| 3.10 | Dashboard → "Histórico de jornadas" | Lista já vem aberta e mostra todas as jornadas, inclusive a atual; início e fim têm data e hora completas, além de hodômetros, percurso, litros e custo |
| 3.11 | Com uma jornada salva em andamento, informar km final, consumo e tocar "Salvar e encerrar" | Registro é encerrado no servidor, a tela muda para encerrada e o histórico ganha data/hora de fim; recarregar mantém os mesmos dados |

## 4. Regressão rápida do que continua vivo

| Passo | Ação | Esperado |
| --- | --- | --- |
| 4.1 | Dashboard → Abastecimentos → Faturamento → Minha Moto → Clientes | Navegação e re-render normal; sem console red |
| 4.2 | Faturamento: resumo e gráfico mensal | Valores batem com entradas/despesas |
| 4.3 | Recarga em qualquer aba | Estado local reconstrói; badges seguem corretos |

---

## Cobertura: automática (mocka) × manual (real)

A suíte automatizada **mocka** o que segue — por isso estas partes exigem o
roteiro manual acima e NÃO podem ser validadas por `vitest run`:

| Aspecto | Cobertura real hoje |
| --- | --- |
| Autenticação Firebase (login/sessão/logout) | Manual (1.1–1.5); suíte web mocka `firebase/auth` |
| Regras do Firestore no servidor (isolamento por UID) | Automática — `firestore-rules.emulator.test.ts`: proprietário, outro UID e anônimo em 9 caminhos do beta, incluindo marcadores de criação e controle da jornada, mais negação fora de `users/{uid}`; troca real de sessão ainda é manual |
| Criações duráveis de abastecimentos, gastos e entradas | Automática — `durable-create-manager.test.ts`, `local-storage-durable-create-store.test.ts` e `firestore-durable-create-gateway.emulator.test.ts`: pré-persistência, resposta perdida, recarga, UID, retries simultâneos, interleaving de duas abas, compatibilidade V1, colisão e reconexão injetada; a UI ainda exige teste manual |
| Ciclo legado de Jornada e mescla remota | Automática — `pending-local-write.test.ts`; criações financeiras novas não usam `settleLocalAdd` |
| Wiring das pontes no monólito | Automática estática — `pending-sync-wiring.test.ts`, complementada pelo ensaio no navegador |
| Regras de jornada (1 aberta, km final, idempotência de abertura e fechamento, custo e litros) | Automática — `jornada/**` (43 testes) |
| Jornada no Firestore (persistência, histórico e concorrência) | Automática — `firestore-jornada-repository.emulator.test.ts` (5 passaram): abertura, leitura por nova instância, fechamento, histórico, ausência de entrada financeira, duas aberturas divergentes, dois fechamentos, legado sem controle e duplo início idêntico. O ensaio em aparelhos físicos continua pendente |
| Recebimento × cancelamento no Firestore | Automática — `client-writer.emulator.test.ts` (1) executa as duas transações reais em concorrência e verifica os dois resultados admissíveis; teste determinístico do interleaving cancelamento-primeiro permanece em `client-writer.test.ts` |
| Repositórios de Abastecimento, Manutenção, Entrada manual e Moto | Automática — `beta-repositories.emulator.test.ts` grava, edita/reconsulta e verifica documentos reais no Emulator, incluindo snapshot de outro aparelho que não pode reduzir o hodômetro; a criação ativa usa a suíte durável acima |
| Functions no Firestore Emulator | Automática — `functions test:emulator` (gate `FIRESTORE_EMULATOR_HOST`) |
| Desempenho/UX tátil no celular | Manual — revisar em aparelho real antes do beta |

**Critério de liberação do beta:** roteiro manual 1–4 concluído no Android
real, passo 1.6 comprovado também no computador com a mesma conta,
`npm run check` verde na branch `review/beta-preparacao` e
`git diff --check` limpo.
Concorrência entre dois celulares não é gate deste beta.

## Resultados registrados — 28–29/09/2026

| Verificação | Resultado | Limite da evidência |
| --- | --- | --- |
| `npm run check` no checkout `review/beta-preparacao` | Passou: typecheck, 58 arquivos/979 testes, build Vite | A suíte rápida usa mocks; aviso de bundle acima de 500 kB não impede build |
| `firebase emulators:exec --only firestore --project demo-motoboy "npm run test:emulator"` | Passou: 4 arquivos/15 testes; 2 testes de concorrência da jornada pulados e não contados como sucesso | Regras de UID, corrida receipt/cancel, persistência de jornada e repositórios beta; snapshot tardio da moto não reduz hodômetro; não simula toda a UI nem aparelhos físicos |
| `firebase emulators:exec --only firestore --project demo-motoboy "npm --prefix functions run test:emulator"` | Passou: 1 arquivo/7 testes | Cobre Functions existentes, não todos os fluxos web |
| `npm run check` em `functions/` | Passou: typecheck, 2 arquivos/22 testes e bundle | Independente do check web |
| Preview local com sessão já aberta | Navegação Painel → Faturamento → Abastecimentos → Minha Moto → Clientes funcionou; menu não mostra Rotas; sem erros de console capturados; recarga após correção da moto manteve dashboard, histórico de 2 jornadas e valores visíveis | Não comprova login/logout, segunda conta nem gravação no servidor |
| Viewport de 390 × 844 px no navegador | Clientes e card/histórico de jornada renderizaram sem overflow horizontal observado; viewport restaurado | Simulação de largura, não teste tátil em aparelho real |
| Cabeçalho de período | Corrigido texto estático `AGO 2026 · semana 3`; preview de 28/09/2026 mostra `SET 2026 · semana 5`, com teste de virada de mês/ano | Não cobre app aberto continuamente durante a virada sem ocultar/reabrir a aba |
| Resumo mensal de abastecimentos | Corrigido: em setembro, registros históricos somente de agosto/julho agora mostram `TOTAL NO MÊS R$ 0,00` no preview; 2 testes para filtragem mensal | Não equivale a salvar um abastecimento novo no servidor |
| Cache do painel na troca de UID | Guarda em memória força recarga mesmo se localStorage falhar; erro de leitura/limpeza do cache faz o painel ignorá-lo sem sobrescrevê-lo; 9 testes de unidade/wiring novos | Troca de contas reais e storage bloqueado no navegador ainda não executados |
| Escrita concorrente da moto | Writer do painel serializa snapshots em voo, usa transação que mantém o maior hodômetro e retenta após falha/retorno da conexão; teste real no Emulator reproduziu a redução antes da correção e passou depois | Sem validação UI offline com dois dispositivos; consumo manual ainda segue o último snapshot |
| Falha síncrona da persistência da moto | Teste reproduziu exceção fora do fluxo de retry; writer agora restaura o snapshot e aceita retry mesmo se `persist` lançar antes de devolver Promise | Teste unitário com persistência injetada; falha de rede na UI real ainda pendente |
| Jornada em dois aparelhos | O Emulator reproduziu duas jornadas abertas simultâneas (esperado: uma) e fechamentos simultâneos com dois resultados divergentes. Abertura usa `findOpen()` + `addDoc()` separados; fechamento usa `updateDoc()` sem comparar status no commit. Os dois testes de reprodução estão explicitamente pulados, aguardando aprovação de correção estrutural da DEC-027 | Bloqueio conhecido para beta multi-dispositivo; não declarar regra global de uma aberta nem fechamento idempotente como comprovados |
| Texto de Moto e Clientes | Preview mostra referências a estimativas de jornada e contas em aberto, sem instruir o uso da aba oculta de Rotas | Revisão de microtexto; não altera cálculos nem dados |
| CI do patch atual | Pendente: novo job `emulator-web` foi adicionado, mas o patch não foi enviado; a última execução publicada (`ef325fe`, 25/09/2026) passou | A CI verde anterior não cobre as alterações locais |
| Navegador com Auth + Firestore Emulators (projeto `demo-motoboy`) | Login da conta A; jornada iniciada, recarregada e encerrada; custo estimado não gerou entrada; logout/login da conta B isolou o histórico; retorno à conta A restaurou dados. Abastecimento, manutenção e entrada manual foram criados, editados e mantidos após recarga. | Teste local em navegador, não comprova uso em aparelho físico nem concorrência real entre dispositivos |
| Motivo de correção financeira | Reprodução: editar abastecimento gravava `editReason: null` no Firestore. Corrigido o envio do motivo antes da escrita nos três formulários; teste estático (3 casos) e leitura dos documentos no Emulator confirmaram os motivos de abastecimento, manutenção e entrada. | Não cobre offline/retry dessas edições; o rastro detalhado `editLog` ainda é local |
| Queda do Firestore durante novo abastecimento (demo) | O card apareceu imediatamente como **Sincronizando**, sem mensagem de sucesso; ficou nesse estado durante a queda. Após restaurar o emulador, concluiu automaticamente uma vez (`1` documento da tentativa no Firestore). | Não apareceu **Não salvo** nem retry enquanto a promessa do SDK aguardava a rede. A recarga durante a queda e o retry idempotente seguem sem comprovação; correção estrutural proposta, aguardando aprovação. O reinício do emulador descartou dados anteriores desse projeto demo, não dados reais. |
| Cliente/recebimento no navegador após reiniciar os Emulators | Inconclusivo: o cadastro de cliente não confirmou na UI nem criou documento; o SDK registrou erro de parsing do canal WebChannel no proxy local. A suíte transacional direta no Emulator continua verde. | Não usar esse ensaio de navegador como evidência de fluxo de clientes/recebimentos; requer nova sessão de teste estável. |

## Resultados adicionais — 30/09/2026 (DEC-028)

| Verificação | Resultado | Limite da evidência |
| --- | --- | --- |
| `npm run check` após ligar os três formulários às tentativas duráveis | Passou: typecheck global, 60 arquivos/986 testes e build Vite | Executado antes dos últimos ajustes de preservação do cache e do proxy; repetir no fechamento da etapa |
| `firebase emulators:exec --only firestore --project demo-motoboy 'npm run test:emulator -- src/shared/infrastructure/firestore-durable-create-gateway.emulator.test.ts'` | Passou: 8 testes, incluindo três tipos, resposta perdida seguida de recarga, retries simultâneos, UID divergente, colisão, remoção após commit e falha/reconexão injetada | A falha de rede do último caso foi injetada no gateway; não simula queda física de conexão do navegador |
| Browser isolado `127.0.0.1:5174` com Auth + Firestore Emulators `demo-motoboy` | Um abastecimento ficou **Aguardando conexão** após falha do proxy, sobreviveu à recarga com ação de retry e confirmou usando o mesmo ID; só depois entrou nos totais. Manutenção e entrada manual salvaram e foram recuperadas após recarga. Conta B abriu sem os dados da A; retorno à A restaurou os três registros e o resultado R$ 35,00. | Dados exclusivamente sintéticos em origem e projeto demo. A falha do proxy antecedeu o commit; a resposta perdida **após** commit é coberta no teste do Emulator, não observada via UI. Não equivale a teste em aparelho físico ou serviço real. |
| Proxy local do Firestore | Corrigido encaminhamento de `/v1/projects/`, usado pelo SDK nas transações; antes o navegador registrava `Unexpected end of JSON input` e a criação não concluía. Após o ajuste, retry da tentativa pendente confirmou e a leitura remota ficou estável. | Somente configuração de desenvolvimento; nenhuma regra/deploy alterado. |
| Viewport 390 × 844 px no navegador embutido | Painel e menus acessíveis; medição DOM: `scrollWidth` 375 = `clientWidth` 375, sem overflow horizontal nesse estado. | Simulação de viewport, não ensaio tátil em aparelho real nem inspeção visual completa de todos os modais. |
| Cliente e recebimento no browser após correção do proxy | Cliente sintético criado e recuperado após recarga. Uma conta de teste de R$ 100 foi preparada diretamente no Emulator; recebimento parcial de R$ 40 deixou R$ 60 a receber e criou uma única entrada de R$ 40, conferida no faturamento após recarga. | A conta de R$ 100 foi fixture de teste, não gerada pela UI de Rotas (fora do beta). Não exercita cancelamento concorrente por dois aparelhos. |
| Tentativas simultâneas em duas abas | Teste comportamental reproduziu perda de uma tentativa no array local V1. Corrigido com chave V2 individual por tentativa, leitura preservada de V1 e marcador V2 após confirmação. Testes verificam ambas as tentativas, recarga de V1, isolamento de UID e falha de storage. | O interleaving exato é simulado no teste unitário; o ensaio de duas abas reais está na linha seguinte. |
| Duas abas reais no browser com Auth + Firestore Emulators (`demo-motoboy-browser2`) | Mesma conta sintética em duas abas: abastecimento de R$ 50 e manutenção de R$ 25 foram preparados com o Firestore parado. Ambas mostraram **Aguardando conexão** após recarga. Retomadas separadamente, confirmaram e o Firestore continha exatamente 1 documento e 1 marcador por tentativa, com IDs coincidentes. | O reinício do Emulator apagou a conta sintética; ela foi recriada com o mesmo UID e foi necessário entrar novamente antes de retomar. Não prova sessão contínua durante falha de Auth nem simultaneidade de commits em aparelhos físicos. |
| Verificação final após a correção de duas abas | `npm run check`: typecheck global, 60 arquivos/992 testes e build passaram. Firestore Emulator isolado `demo-motoboy-verify`: 5 arquivos/24 testes passaram; `git diff --check` sem erros. | Os 2 testes antigos de concorrência da jornada continuam pulados; CI publicada e aparelho real ainda não validam este patch. |

Nota operacional: a suíte completa de Rules chama `clearFirestore()` no projeto
`GCLOUD_PROJECT` informado. A execução local posterior ao ensaio visual
descartou os registros **sintéticos** criados naquele Emulator; não apontou
para o projeto real nem removeu registros do usuário. Próximas execuções devem
usar um `demo-*` exclusivo para a suíte, separado do projeto demo do browser.
Após essa execução, a suíte foi repetida em `demo-motoboy-verify` para não
voltar a limpar os dados usados no browser: 5 arquivos, 24 testes passaram e
2 cenários antigos de concorrência da jornada ficaram pulados **naquela
execução anterior**; ambos foram reativados e passaram na DEC-029. O `npm run
check` final da etapa passou com 60 arquivos/992 testes, typecheck global e
build. A CI publicada permanece pendente porque não houve push.

**Roteiro manual ainda aberto em 30/09:** 1.2–1.5 no projeto real (login, troca de UID,
sessão e falha de rede); 2.2–2.10 no projeto real (offline, retry, resposta
perdida e exclusão remota); 2.7 e 2.10 foram simulados no Emulator, mas não
em aparelho físico; 3.5 e 3.8 (idempotência/offline de jornada), confirmação de 3.10 com jornada
aberta e teste tátil em celular físico. Os fluxos felizes de 1.2–1.4, 2.1,
2.4, 3.2–3.4, 3.6–3.7, 3.9, 3.11 e 4.2–4.3 passaram apenas no projeto demo;
não são evidência no projeto real. A sessão encontrada no preview pode conter
dados reais; nenhuma mutação financeira ou exclusão foi feita nela durante
esta verificação. Para executar o restante com segurança, são necessárias
duas contas de teste e confirmação de que seus dados são descartáveis.

## Resultado adicional — 30/09/2026 (DEC-029)

Os dois testes de concorrência da jornada que estavam pulados foram
reativados e executados separadamente no Firestore Emulator, antes da
correção: duas aberturas produziram **2 jornadas abertas** (esperado: 1) e
dois fechamentos devolveram **km final/custo divergentes**. Após a mudança
transacional, a suíte focada passou com 5 testes; a suíte completa do
Firestore Emulator passou com **5 arquivos/29 testes, nenhum pulado**,
incluindo regras de UID para `jornadaState/current`. Um teste adicional
preservou uma jornada legada sem controle e outro confirmou que dois inícios
idênticos geram um único documento. Nenhuma regra foi alterada ou publicada.

Permanecem abertos: ensaio do fluxo de jornada em dois aparelhos físicos,
CI publicada (o patch não foi enviado), autenticação e falha de rede no
projeto real e revisão tátil em celular. A transação só protege clientes que
executam esta versão; instâncias antigas com `addDoc()` precisam ser
atualizadas antes do beta multi-dispositivo.

### Ensaio de interface — 01/10/2026

No navegador local com Auth + Firestore Emulators (`demo-motoboy-journey-ui`),
duas abas da mesma conta sintética enviaram leituras iniciais diferentes.
Uma jornada foi criada; a outra aba apresentou o conflito e recarregou a
jornada vencedora sem manter uma linha fantasma **Não salvo**. Após recarga,
o histórico mostrou exatamente uma jornada fechada anterior e uma aberta.
O Firestore confirmou esses dois documentos, `activeJornadaId` apontando
para a aberta e **zero entradas financeiras**. O fechamento anterior foi
feito pela UI (1.001 → 1.100 km, 35 km/L, R$ 5/L), com custo estimado de
R$ 14,14, preservado após recarga. Isto usa duas abas de um navegador, não
dois aparelhos físicos nem o projeto real.

Após a reconciliação da interface, `npm run check` passou com **62 arquivos,
999 testes, typecheck global e build**. A suíte integral do Firestore Emulator
foi repetida em `demo-motoboy-journey-final`: **5 arquivos/29 testes passaram,
nenhum pulado**. O bundle principal continua acima do aviso de 500 kB do
Vite; isso não impediu o build, mas merece revisão de desempenho no celular.

Um novo teste no Emulator reproduziu um caso ainda aberto: abertura
confirmada, resposta perdida, fechamento por outro aparelho e retry do
início original criaram uma **segunda jornada aberta**. O teste está
explicitamente pulado enquanto se aguarda aprovação para fixar a identidade
da abertura depois do fechamento; não contar este caso como coberto pela
DEC-029. O beta multi-dispositivo permanece bloqueado por esse defeito.
No estado atual, `npm run check` passou com 62 arquivos/999 testes, tipagem
global e build; a suíte integral do Firestore Emulator passou com 29 testes
e **1 pulado** (este caso), sem confundir verde parcial com liberação do beta.

### Ensaio adicional em cópia isolada — 01/10/2026

Uma cópia separada do checkout `review/beta-preparacao` (HEAD `ef325fe`),
com o mesmo estado Git e sem copiar `.env`/`.env.local`, foi validada sem
alterar os dois checkouts anteriores. `npm run check` passou com typecheck
global, **62 arquivos/999 testes** e build. `npm --prefix functions run check`
passou com typecheck, **2 arquivos/22 testes** e auditoria do bundle; o build
das Functions precisou de leitura fora do sandbox para resolver imports, sem
deploy. A suíte integral do Firestore Emulator (`demo-motoboy-clone-verify`)
passou com **29 testes e 1 pulado**: o retry após fechamento por outro
aparelho continua sem correção e não conta como sucesso.

No navegador local com Auth + Firestore Emulators
(`demo-motoboy-clone-browser`), duas contas sintéticas foram criadas apenas
no Emulator. A conta A iniciou uma jornada de 1.000 km, recarregou e a
encerrou em 1.100 km com 35 km/L e R$ 5/L: a UI exibiu 100 km, 2,86 L e
R$ 14,29 somente como estimativa. A conta B abriu com histórico vazio e
continuou vazia após recarga. Com os Emulators indisponíveis, B iniciou uma
jornada de 2.000 km; a UI mostrou **Não salvo** e **Tentar salvar novamente**,
preservou a tentativa após recarga e recusou o encerramento antes da
sincronização. Após restaurar o export do Emulator, foi necessário entrar
novamente; a tentativa da B permaneceu disponível e o retry a confirmou.
Leitura direta no Firestore confirmou **1 jornada encerrada para A, 1 aberta
para B e 0 entradas financeiras em ambas**. O export reportou falha do
processo após indicar conclusão; seus arquivos foram importados e a leitura
posterior confirmou a preservação dos dados sintéticos. Este ensaio não
simula resposta perdida depois do commit, dois aparelhos físicos nem o
projeto real. A revisão tátil em celular e a CI publicada seguem pendentes.
Um export final foi importado novamente e confirmou os mesmos totais
(A: 1 encerrada; B: 1 aberta; ambas sem entradas); os exports sintéticos
ficaram fora do repositório em `Site Motoboy/emulator-artifacts/`.

### Bloqueio reproduzido: troca de UID com jornada não salva — 01/10/2026

Em outra origem local (`127.0.0.1:5175`) do mesmo projeto demo, a conta C
iniciou uma jornada de 3.000 km com os Emulators indisponíveis. O painel
mostrou **Não salvo** e **Tentar salvar novamente**. Após restaurar o estado
exportado, entrar primeiro na conta A e voltar à C deixou o histórico da C
vazio, sem ação de retry. Consulta direta confirmou **0 jornadas remotas**
para C: a tentativa não havia sido confirmada e também não pôde ser
recuperada. A conta A mostrou somente sua jornada encerrada, portanto não
houve vazamento entre UIDs. A causa é `isolateLocalCache()` remover a chave
única `motoboy-front-etapa1-v2-clean` na troca de dono; as jornadas locais
sem `fsId` ainda vivem nessa chave. É perda de uma tentativa não confirmada,
não corrigida por este ensaio. Requer persistência de pendências de jornada
por UID, sem reexpor o cache legado de uma conta à outra. Nenhuma regra ou
dado real foi alterado.

### Gate local adicional de CI — 01/10/2026

O comando do job `emulator-functions` foi executado na cópia isolada com
Firestore Emulator e projeto `demo-motoboy-functions-clone-ci`:
`npm --prefix functions run test:emulator` passou com **1 arquivo/7 testes**.
O workflow contém jobs separados para web, Functions e integração nos
Emulators. Esta execução local não substitui a CI publicada: o patch segue
sem push, por instrução do proprietário, e nenhum novo job foi executado no
GitHub para o HEAD com alterações locais. A CLI do workflow é obtida como
`firebase-tools@latest`, de modo que a versão instalada pela CI pode diferir
da versão local usada neste ensaio.

### Correção da jornada: retry após fecho e troca de UID — 01/10/2026

A DEC-030 foi aprovada e implementada na cópia isolada
`Site Motoboy/Motoboy-beta-current`. Aberturas novas têm ID estável derivado
do hodômetro/data/hora; a transação lê a mesma identidade antes de criar,
inclusive se outro aparelho já encerrou a jornada. Documentos legados com
ID aleatório e o mesmo início são reconhecidos na consulta de compatibilidade.
O painel só anuncia nova abertura quando o retorno continua aberto. Cada
tentativa não confirmada é guardada por UID e por tentativa antes do envio,
sem depender do cache agregado que é limpo na troca de usuário.

`npm run check` passou com tipagem global, **64 arquivos/1.006 testes** e
build (aviso de bundle acima de 500 kB). A suíte integral do Firestore
Emulator passou com **5 arquivos/31 testes, nenhum pulado**, incluindo o
caso antes vermelho de retry após fechamento remoto e uma jornada legada
encerrada. Testes locais cobrem chaves independentes por tentativa, recarga
e isolamento de UID. No navegador com Auth Emulator ativo e Firestore
indisponível, a conta sintética A iniciou 3.000 km; após recarga viu
**Não confirmado** e **Tentar salvar novamente**. A conta B entrou com
histórico vazio; ao retornar à A, a mesma tentativa reapareceu. Depois de
reiniciar Auth + Firestore Emulators e reentrar na mesma conta sintética, o
retry confirmou a jornada. Outra recarga manteve apenas uma jornada aberta;
leitura direta no Firestore encontrou **1 jornada de 3.000 km em A, 0 em B e
0 entradas financeiras nas duas contas**. `npm --prefix functions run check`
passou com tipagem, 2 arquivos/22 testes e build. A CI publicada e o ensaio
em aparelho físico ainda não cobrem o patch local. Nenhuma regra foi alterada
ou implantada; os registros anteriores permanecem preservados.

Na revisão para acesso móvel por HTTP na rede local, a geração de IDs de
jornada, recebimento e criações duráveis deixou de depender exclusivamente de
`crypto.randomUUID()`, indisponível em alguns contextos não seguros. O helper
compartilhado usa `randomUUID` quando presente, UUID v4 sobre
`crypto.getRandomValues()` como primeira alternativa e, em WebViews que
removem Web Crypto por completo, combina tempo e entropia local. Esses IDs
servem para unicidade/idempotência e nunca são credenciais ou segredos.

### Validação local final desta etapa — 05/10/2026

| Verificação | Resultado | Limite da evidência |
| --- | --- | --- |
| `npm run check` | Passou: tipagem global, **65 arquivos/1.009 testes** e build Vite | O bundle principal mantém o aviso acima de 500 kB; não é erro de build |
| Firestore Emulator web (`demo-motoboy-final2-20261005`) | Passou: **5 arquivos/31 testes, nenhum pulado** | Projeto exclusivamente `demo-*`; nenhum dado ou regra de produção foi alterado |
| `npm --prefix functions run check` | Passou: tipagem, **2 arquivos/22 testes** e auditoria do bundle | Check local; não substitui o job publicado |
| Firestore Emulator Functions (`demo-motoboy-functions-final2-20261005`) | Passou: **1 arquivo/7 testes** | Projeto exclusivamente `demo-*`; sem deploy |
| Viewport móvel 390 × 844 px | Dashboard, card e histórico de jornada e formulário de abertura renderizaram sem overflow horizontal. Medição DOM confirmou `scrollWidth <= innerWidth`; menu, fechar, cancelar e salvar têm alvo mínimo de **44 px**. O formulário permaneceu totalmente dentro do viewport. | Simulação responsiva no navegador embutido; não substitui toque, teclado virtual e safe-area em aparelho físico |
| HTTP LAN real (`http://192.168.0.167:5176`) sem Web Crypto | A reprodução confirmou `window.crypto === undefined` e inicialmente encontrou crash no bootstrap do código oculto de Rotas. Após centralizar também esses geradores em `generateUuid()`, o painel abriu. A UI criou **1 cliente**, salvou **1 abastecimento de R$ 30,50** com documento + marcador no mesmo ID, e registrou **1 recebimento de R$ 20,00**, reduzindo o saldo sintético de R$ 50,00 para R$ 30,00 e criando uma única entrada com o mesmo `receiptOperationId`. Após recarga, o dashboard mostrou R$ 20,00 recebido, R$ 30,50 em despesas e resultado de -R$ 10,50. | Navegador no mesmo computador acessando pelo IP da LAN; comprova o contexto inseguro e o fallback, mas não substitui aparelho físico |
| Ensaio de UI demo antes da autorização específica (`demo-motoboy-browser-final2-20261005`) | Auth e Firestore Emulators e Vite iniciaram; conta sintética criada e marcada como verificada apenas no Emulator. A revisão automática bloqueou o login antes do envio das credenciais; os serviços e a aba foram encerrados. | Registro histórico do bloqueio; o proprietário autorizou o login em seguida, e o novo ensaio está na linha abaixo |
| Ensaio de UI autorizado (`demo-motoboy-browser-approved-20261005`) | Login da conta sintética, abastecimento de R$ 30,00 editado para R$ 36,00 com motivo e excluído; manutenção de R$ 25,00 editada para R$ 27,00 com motivo e excluída; entrada manual de R$ 40,00 editada para R$ 45,00 com motivo e excluída. Listas e totais voltaram a zero; após recarga a sessão permaneceu autenticada e os totais continuaram zerados. Leitura direta no Firestore Emulator encontrou **0 documentos** nas três coleções e hodômetro da moto em **1.510 km**. Após sair e desligar o Auth Emulator, o login exibiu **“Serviço temporariamente indisponível. Tente mais tarde.”**, sem informar se o e-mail existe. | Conta e dados exclusivamente sintéticos em projeto `demo-*`. Não cobre resposta perdida após commit pela UI, toque físico, teclado virtual nem projeto beta real |
| Diff | `git diff --check` sem erro; somente avisos esperados de LF → CRLF no Windows | Conferência feita antes da publicação autorizada da branch |

A execução publicada
[`37395331898`](https://github.com/itronicrioverde-pixel/Motoboy/actions/runs/37395331898)
passou nos **quatro jobs** no commit `ff8a1d93cef4106a302fe980e3ea6f0e10ae1979`:
check web, check Functions, Emulator web e Emulator Functions. A etapa
`npm audit --omit=dev` do job web usa `continue-on-error` e **falhou**;
portanto, quatro jobs verdes não significam auditoria limpa. Confirmar
sempre a execução correspondente ao HEAD publicado.

### Triagem da auditoria de dependências — 05/10/2026

- No web, `firebase@12.18.0` → `@firebase/firestore@4.17.1` fixa
  `@grpc/grpc-js` em `~1.9.0`, resolvido como `1.9.16`. A auditoria de
  produção da CI aponta quatro alertas altos na cadeia de dependências.
  Os dois avisos da biblioteca gRPC descrevem comportamento de **servidor**
  ([autorização de certificados](https://github.com/advisories/GHSA-m9gg-hp2v-232j)
  e [mensagens de erro](https://github.com/advisories/GHSA-f596-whhp-79r4)).
  O pacote Firestore exporta uma entrada `browser` separada da `node`, e
  `rg` no bundle Vite gerado não encontrou `grpc-js`, `getAuthContext` nem
  `DownstreamTlsContext`. Essa evidência não mostra um caminho para explorar
  os avisos pelo bundle **web atual**; se o mesmo pacote for executado em
  Node/SSR, é necessário reavaliar. A [faixa fixada pelo Firebase](https://github.com/firebase/firebase-js-sdk/issues/10400)
  não admite a versão gRPC corrigida; não usar `npm audit fix --force`, que
  propõe downgrade incompatível do Firebase.
- Nas Functions, o lockfile usava gRPC `1.14.4`. Foi atualizado somente
  para `1.14.5`, versão corrigida e compatível com a faixa `^1.10.9`
  declarada pelo dependente. `npm ls` confirmou uma cópia `1.14.5` após
  instalação limpa. A auditoria das Functions **ainda falha** com 12
  ocorrências (2 altas, 10 moderadas), principalmente por `node-forge`,
  `qs` e `uuid` na cadeia do `firebase-admin@12.7.0`. A sugestão automática
  de resolver tudo exige `firebase-admin@14.5.0` (upgrade major); isso não
  foi feito nesta etapa. Esses achados exigem avaliação própria antes de
  considerar a auditoria aprovada.
- O aviso alto de `node-forge` trata de **verificação de assinatura RSA** e
  [não indica versão corrigida](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
  No `firebase-admin@12.7.0` instalado, o único `require('node-forge')`
  encontrado está em `credential-internal.js` para ler a **chave privada**
  (`privateKeyFromPem`). Além disso, `functions/src/index.ts` exporta somente
  `scaffoldInfo`, sem callable nem import de Admin no bundle de produção.
  Isso não demonstra um caminho de exploração no código implantável atual,
  mas **não equivale a auditoria limpa**: qualquer callable futuro que use
  Admin precisará de nova revisão de dependências antes do deploy.
- Depois do patch do lockfile, `npm run check` web passou com tipagem global,
  65 arquivos/1.009 testes e build. `npm run check` das Functions também
  passou com tipagem, 2 arquivos/22 testes e build quando executado com
  permissão local suficiente para o esbuild ler o workspace. A CI do commit
  com o lockfile atualizado passou nos quatro jobs, inclusive os Emulators;
  a etapa `npm audit` web falhou novamente (4 alertas altos, não bloqueante
  por `continue-on-error`). Nenhuma regra ou aplicação foi implantada.

### Estado do roteiro de liberação em 05/10

| Bloco | Comprovado nesta revisão | Ainda necessário para liberação |
| --- | --- | --- |
| 1 — Login e UID | Login, logout, troca de conta, recarga e isolamento em contas sintéticas no Auth + Firestore Emulators; tentativa de jornada da conta A não apareceu na B e reapareceu ao retornar à A. Login sem Auth Emulator mostrou erro genérico | Repetir com duas contas de teste do projeto beta e confirmar a experiência sem conexão no aparelho |
| 2 — Gravações e retry | Criação, recarga, falha, reconexão e retry exercitados na UI demo; resposta perdida após commit coberta somente no Emulator. Edição e exclusão de abastecimento, manutenção e entrada manual passaram na UI demo aprovada; cliente, recebimento e abastecimento também foram exercitados via HTTP LAN sem Web Crypto | Executar 2.1–2.10 no aparelho/projeto beta, especialmente resposta perdida após commit e toque duplo no retry pela interface |
| 3 — Jornada | Abertura, recarga, fechamento, custo só estimado, histórico, conflito entre aparelhos, tentativa offline, troca de UID e retry demonstrados em navegador demo e Emulator | Executar 3.1–3.11 no aparelho/projeto beta, incluindo hodômetro real, teclado virtual e histórico com jornada aberta e encerrada |
| 4 — Regressão | Navegação, totais e recarga exercitados no navegador demo; viewport 390 × 844 sem overflow horizontal | Conferir navegação, valores e interação tátil em aparelho físico com as contas de teste |
| CI | Checks locais aprovados e quatro jobs verdes no commit `ff8a1d9`; auditoria web e auditoria separada das Functions não estão verdes | Revalidar qualquer commit posterior e avaliar os alertas restantes antes de introduzir runtime Admin em callable |

O proprietário autorizou commit/push da branch e o login sintético em 05/10;
o ensaio acima cobriu o login. Os quatro jobs passaram no commit `ff8a1d9`.
O beta ainda não pode ser declarado liberado até a CI do HEAD final e a
execução do roteiro em aparelho físico. O proprietário fará a etapa no celular.

### Ensaio complementar de UI: concorrência, recarga e reconexão — 06/10/2026

No navegador local, com Vite e Auth + Firestore Emulators no projeto isolado
`demo-motoboy-progress-20261006`, duas contas sintéticas verificadas foram
usadas como A e B. Na conta A, um duplo clique em **Salvar abastecimento**
para R$ 30,00 exibiu somente uma tentativa em andamento e terminou com um
único documento no Firestore. A recarga preservou o valor; B exibiu totais
zerados e nenhum abastecimento; ao retornar à A, o registro reapareceu.

Para testar a falha antes do commit, o processo do Firestore Emulator foi
interrompido. A criou outro abastecimento de R$ 14,00: a lista passou de
**Sincronizando** para **Aguardando conexão**, manteve **Tentar novamente**
e não incluiu os R$ 14,00 nos totais. Após recarga e novo login sintético,
a tentativa continuou em A; B não a viu; ao voltar à A, continuou disponível.
Depois de reiniciar os Emulators e recriar as mesmas contas com os mesmos UIDs,
um duplo clique em **Tentar novamente** confirmou a tentativa. A leitura
direta encontrou **1 abastecimento e 1 marcador `createAttempts`**, ambos
com o ID `7dfab377-86a3-47c5-aa0e-ae19a4149c24`; após nova recarga, a
UI mostrou R$ 14,00 confirmado e nenhum badge pendente.

O reinício dos Emulators não importou o estado anterior: o primeiro registro
de R$ 30,00 foi perdido **no ambiente sintético**, não excluído pelo app.
Este ensaio cobre falha antes do commit, recarga, UID, reconexão e duplo
clique na UI; **não** cobre resposta perdida após commit, que permanece
testada apenas no Emulator em nível de infraestrutura. Também não substitui
toque, teclado, rede e safe-area no Android físico nem usa o projeto beta real.
Nenhum deploy ou regra foi alterado.

### Ensaio complementar de UI: manutenção e entrada manual — 06/10/2026

No projeto demo isolado `demo-motoboy-progress-1006`, a conta sintética A
registrou, com o Firestore Emulator indisponível, uma manutenção de R$ 42,00
(`Teste offline - troca de óleo`) e uma entrada manual de R$ 27,00
(`Teste offline - gorjeta`). Ambos os itens passaram de **Sincronizando**
para **Aguardando conexão**, ofereceram **Tentar novamente** e não entraram
nos totais antes da confirmação. Após recarregar e entrar novamente com o
mesmo UID, os dois continuaram pendentes. A conta sintética B não viu nenhum
deles nas respectivas listas.

Após religar Auth e Firestore Emulators e recriar as contas sintéticas com os
mesmos UIDs, A acionou **Tentar novamente** em cada item com duplo clique.
Ambos foram confirmados. A leitura direta do Firestore Emulator mostrou
exatamente **1 documento `manutencoes`**, **1 documento `entradas`** e
**2 marcadores `createAttempts`**, um por documento e com o mesmo ID:
`916bd9cb-8885-40f6-9b6e-b496f8d21c5b` para a manutenção e
`8eef26a4-07c1-4100-bd57-1e2c9c61f280` para a entrada. Os payloads
persistidos mantiveram descrição, valor e data informados antes da falha.
Depois de nova recarga, o painel exibiu R$ 27,00 recebidos, R$ 42,00 de
despesas e resultado de -R$ 15,00, sem status pendente nesses registros.

O segundo clique da entrada encontrou o botão já substituído pela UI após a
confirmação; por isso o ensaio demonstra **um único resultado persistido**,
mas não prova que duas requisições simultâneas chegaram ao Firestore. Como
no ensaio de abastecimento, a falha simulada ocorreu **antes do commit**;
resposta perdida após commit continua coberta somente pelos testes do
Emulator. Os Emulators foram reiniciados sem importação de dados e o ensaio
não substitui Android físico nem usa o projeto beta real. Nenhum deploy ou
regra foi alterado.

### Ensaio de viewport estreito — 06/10/2026

Com Vite e Auth + Firestore Emulators no projeto isolado
`demo-motoboy-mobile-1006`, uma conta sintética verificada foi usada para
inspecionar a interface em **360 × 800 px** e **320 × 640 px** no navegador.
O login, o painel, o menu, Abastecimentos, Minha Moto, Faturamento e Clientes
foram navegados. O formulário de abertura da jornada e os modais de
manutenção, entrada manual e cliente foram abertos e inspecionados; seus
campos e botões ficaram acessíveis. Em 320 px, o modal de manutenção usou
rolagem interna até **Salvar gasto**, e o login usou rolagem vertical até
**Entrar**. O gráfico anual rolou dentro do próprio card.

A medição do DOM não encontrou overflow horizontal do documento nos estados
verificados: em 320 px, `scrollWidth` foi igual a `clientWidth` (305 px nas
telas com barra vertical e 320 px em Clientes/login). O modal de jornada
ficou entre x=5 e x=300 px; manutenção e entrada também ficaram nessa faixa.
Esta é **simulação de viewport**, não prova de toque, teclado virtual,
safe-area ou desempenho em Android físico. Nenhum registro financeiro foi
criado e nenhum deploy ou regra foi alterado.

### Auditoria complementar de dependências — 07/10/2026

A auditoria de produção das Functions identificou um alerta **crítico** novo
em `proxy-addr@2.0.7` (cadeia `firebase-functions → express → proxy-addr`),
relativo à confiança incorreta em IPs quando a aplicação configura certas
sub-redes IPv6 mapeadas para IPv4. O [aviso oficial](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)
marca `2.0.8` como corrigida. O `express@4.22.2` instalado aceita essa
versão pela faixa `~2.0.7`; portanto, apenas `functions/package-lock.json`
foi atualizado, sem upgrade major nem mudança no código da aplicação.

Após `npm ci`, `npm ls` mostrou `proxy-addr@2.0.8`; `npm audit --omit=dev`
passou a reportar **0 críticos, 2 altos e 10 moderados** nas Functions (o
comando ainda retorna falha). `npm run check` das Functions passou com
tipagem, 22 testes e build; a suíte das Functions no Firestore Emulator
passou com **7 testes**. A auditoria web continua com **4 altos**. Estes
alertas restantes seguem abertos e os quatro jobs verdes da CI não devem
ser interpretados como auditoria limpa. Nenhum deploy ou regra foi alterado.

### Paridade entre sessões independentes da mesma conta — 07/10/2026

Com Auth + Firestore Emulators no projeto descartável
`demo-motoboy-parity-1007`, a mesma conta sintética entrou em duas origens
independentes do navegador (`127.0.0.1:5177` e `localhost:5177`). A primeira
sessão cadastrou **Cliente Paridade Beta**; a segunda, após recarga, exibiu
esse cliente. A segunda criou a entrada **Paridade PC para celular** de
R$ 73,50; a primeira, após recarga, mostrou a entrada e o mesmo total no
faturamento. Uma jornada foi iniciada em 12.345 km e encerrada em 12.380 km
na segunda sessão; a primeira mostrou, após recarga, histórico encerrado,
percurso de 35 km e custo **estimado** de R$ 6,00. Um abastecimento de
R$ 30,00 feito na primeira apareceu na segunda após recarga, com resultado
mensal de R$ 43,50 (R$ 73,50 recebidos menos R$ 30,00 de despesa real).

Logo após a abertura da jornada, a interface exibiu transitoriamente
**Aguardando conexão** junto de um aviso de início. A recarga de ambas as
sessões recuperou a jornada sem badge pendente; este ensaio considera a
persistência confirmada apenas após essa leitura independente, não pelo
aviso transitório. Não houve escrita simultânea entre sessões. O teste
comprova continuidade sequencial em duas sessões de navegador com o mesmo
backend demo; **não** comprova Android físico, projeto beta real, toque,
teclado virtual, rede móvel ou paridade de todos os fluxos do roteiro 1.6.
O teste Android ↔ computador e o isolamento da conta B continuam necessários
para a aprovação final. Nenhum deploy ou regra foi alterado.

### Correção do indicador da jornada confirmada — 07/10/2026

O ensaio acima revelou que o aviso de sucesso da abertura podia coexistir
com **Aguardando conexão**. A causa foi confirmada no código: o callback de
sucesso marcava `fsId` e `syncState: saved`, mas mantinha `pendingCreateId` no
registro local; o indicador priorizava esse ID e apresentava uma pendência
inexistente até a próxima recarga. O painel agora remove a identidade local
depois de retirar a tentativa do armazenamento, e o indicador não mostra
pendência para um registro com ID remoto e estado salvo.

O teste de regressão falhou antes da correção e passou depois. Na UI com
Auth + Firestore Emulators (`demo-motoboy-badge-1007`), uma conta sintética
abriu jornada em 1.000 km: **Sincronizando** apareceu durante o envio;
após a confirmação, o aviso de início surgiu sem badge pendente. A recarga
manteve a jornada aberta no histórico, também sem badge. A falha de rede e
o retry continuam cobertos por testes anteriores; este ensaio não os repetiu
nem substitui a verificação no Android físico/projeto beta. Nenhum deploy ou
regra foi alterado.

### Uma conta no Android e acesso opcional no computador — 07/10/2026

O cenário de uso foi esclarecido: **um Android por conta**, com acesso
opcional à mesma conta no computador. Não é requisito operar dois celulares
simultaneamente. As sessões independentes de navegador abaixo simulam a
continuidade entre aparelhos, não substituem o teste no Android real.

Em Auth + Firestore Emulators isolados (`demo-motoboy-parity2-1007`), a conta
sintética A registrou uma manutenção de R$ 32,00 e 5.000 km. Após recarga,
a sessão do computador mostrou a mesma manutenção, quilometragem e despesa.
O computador gravou consumo manual de 41 km/L; a outra sessão, após recarga,
mostrou 41 km/L. Uma conta de cliente **sintética de teste**, de R$ 100,00,
foi preparada diretamente no Emulator porque a aba Rotas está oculta no beta.
A conta A recebeu R$ 40,00 pela interface; após recarga, o computador exibiu
saldo devedor de R$ 60,00, uma entrada de R$ 40,00 e resultado mensal de
R$ 8,00 após a manutenção. Esse ensaio **não valida** a criação da conta a
partir de uma rota real.

No mesmo computador, a troca para a conta sintética B exibiu painel sem
registros, zero clientes e moto sem a manutenção ou quilometragem da conta A.
Ao voltar para A, os valores reapareceram. A leitura direta do Firestore
Emulator confirmou A com saldo de cliente de R$ 60,00, uma entrada de
recebimento e moto em 5.000 km/41 km/L; B não tinha clientes nem entradas.
Não houve escrita simultânea entre as sessões.

O ensaio revelou que o consumo manual dizia “salvo” antes da confirmação
remota, pois o writer aplica debounce. A interface passou a mostrar
**Sincronizando** durante a tentativa, **Aguardando conexão. Ainda não
confirmado** em erro e **salvos à mão** somente após o retorno da transação;
a hidratação remota também atualiza campo e status. O teste focado foi
executado e a UI foi verificada novamente no Emulator. Ainda faltam o teste
no Android físico e no projeto beta real, inclusive rede móvel, reconexão e
teclado virtual. Nenhum deploy ou regra foi alterado.

### Pendência reproduzida: consumo manual sem confirmação — 08/10/2026

No Auth + Firestore Emulators isolado `demo-motoboy-moto-offline-1007`, uma
conta sintética confirmou inicialmente 35 km/L. Com os Emulators parados,
informou 39 km/L: a UI mostrou **Sincronizando**, não “salvo”. Após recarga
ainda sem conexão, o campo mostrou 39 km/L e **Verificando sincronização**.
Reiniciados os Emulators com o mesmo UID e o valor remoto anterior de
35 km/L, uma nova entrada na conta carregou **35 km/L salvos**, substituindo
os 39 km/L não confirmados. Leitura direta do Firestore confirmou apenas
35 km/L no servidor. Portanto, a correção visual anterior não oferece
retry durável do consumo manual após recarga; a tentativa pode ser perdida.

O reinício dos Emulators também reiniciou o Auth, exigindo novo login; este
ensaio demonstra a perda da tentativa para o mesmo UID, mas não simula com
fidelidade uma queda apenas do Firestore com Auth contínuo. A correção
proposta é persistir a tentativa de consumo separadamente por UID antes do
envio, restaurá-la após recarga, exibir **Não confirmado** e retry visível,
removendo-a somente após confirmação ou reconciliação remota. Mudança de
arquitetura/registro de decisão aguardam aprovação do proprietário. Não
houve alteração de código, regra ou deploy nesta etapa.
