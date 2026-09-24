# Beta — roteiro manual no navegador e cobertura

Roteiro de teste manual para a preparação do beta (`review/beta-preparacao`).
Ele complementa a suíte automatizada (vitest) cobrindo o que os testes mockam:
autenticação real, Firestore real e comportamento multi-dispositivo.

> NUNCA executar `firebase deploy` sem autorização. Estes passos usam o
> preview local (`npm run dev`) com o projeto real do `index.html`.
> A suíte automatizada, por sua vez, isola cada camada: o web suite mocka
> Firebase e DOM; o `functions/test:emulator` roda no Firestore Emulator.

---

## 1. Autenticação e isolamento por UID (não coberto por teste)

| Passo | Ação | Esperado |
| --- | --- | --- |
| 1.1 | Rodar `npm run dev` e abrir o app | Tela de login aparece; painel não é revelado antes |
| 1.2 | Entrar com um e-mail/senha válido | Painel abre; nome do menu = "Painel" |
| 1.3 | Sair (menu → Sair) e entrar com OUTRO e-mail | Dados do usuário anterior SUMEM (isolamento por UID); página recarrega |
| 1.4 | Recarregar a página com a mesma sessão | Dados persistem (abastecimentos/entradas/jornada continuam) |
| 1.5 | Desligar a rede no DevTools (offline) e tentar o login | Nenhuma mensagem revela se o e-mail existe; erro genérico |

## 2. Etapa 1 — gravação só confirmada pelo servidor

| Passo | Ação | Esperado |
| --- | --- | --- |
| 2.1 | Abastecimentos → salvar um novo | Soma só é anunciada como "salvo" DEPOIS da confirmação; sem badge permanece |
| 2.2 | Offline: salvar um abastecimento | Badge **Sincronizando**; em falha, badge **Não salvo** e o formulário continua carregado |
| 2.3 | Voltar a rede e tentar de novo o registro "Não salvo" | Vira **salvo** com fsId; sem duplicar a linha |
| 2.4 | Editar um abastecimento salvo | Janela de motivos abre; "Atualizado" só após confirmação remota |
| 2.5 | Excluir um abastecimento salvo | Some da lista só depois de o Firestore confirmar |
| 2.6 | Repetir 2.1–2.5 para Manutenção e para Entrada manual (Faturamento) | Mesmo comportamento; badge nas 3 listas |

## 3. Etapa 2 — Jornada pelo hodômetro

| Passo | Ação | Esperado |
| --- | --- | --- |
| 3.1 | Menu lateral | Não há mais "Rotas" nem "Histórico de rotas" |
| 3.2 | Dashboard → card JORNADA → "Iniciar jornada" | Card mostra KM INICIAL (km atual da moto), KM ATUAL e PERCORRIDO |
| 3.3 | Avançar o km da moto (Minha Moto ou via abastecimento) | PERCORRIDO sobe no card |
| 3.4 | Recarregar a página | A jornada continua em aberto (persistida no Firestore) |
| 3.5 | "Iniciar jornada" com uma já em aberto | Rejeitado com aviso (uma em aberto por usuário) |
| 3.6 | "Encerrar jornada" | Custo estimado aparece (km ÷ consumo × preço); toast com o valor |
| 3.7 | Conferir Faturamento | NENHUMA despesa/entrada criada com o custo estimado |
| 3.8 | Offline: iniciar jornada | Badge **Sincronizando**/**Não salvo**; encerrar exige sincronia (aviso) |
| 3.9 | Última jornada fechada | Card mostra PERCURSO + CUSTO ESTIMADO + referências (km/L · R$/L) |

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
| Regras do Firestore no servidor (isolamento por UID) | Manual; testes de repositório mockam `firebase/firestore` |
| Ciclo salvo/pendente/falhou (módulo puro) | Automática — `pending-local-write.test.ts` (17) |
| Wiring das pontes no monólito | Automática estática — `pending-sync-wiring.test.ts` (15) |
| Regras de jornada (1 aberta, km final, idempotência, custo) | Automática — `jornada/**` (22 testes) |
| Jornada no Firestore (persistência real, reload, 2 aparelhos) | Manual (3.4–3.9); repositório mocka Firestore |
| Functions no Firestore Emulator | Automática — `functions test:emulator` (gate `FIRESTORE_EMULATOR_HOST`) |
| Desempenho/UX tátil no celular | Manual — revisar em aparelho real antes do beta |

**Critério de liberação do beta:** roteiro manual 1–4 concluído em aparelho
real + `npm run check` verde na branch `review/beta-preparacao` + `git diff
--check` limpo.