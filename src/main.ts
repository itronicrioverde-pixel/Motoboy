import './features/auth/presentation/login.css';
import { showToast } from './shared/presentation/notifications/index';
import { mountLoginView, unmountLoginView } from './features/auth/presentation/login-view';
import { observeAuth, isAuthenticated, logout } from './features/auth/application/auth-service';
import {
  installAbastecimentosBridge,
  loadAbastecimentosIntoPanel,
} from './features/abastecimentos/presentation/panel-bridge';
import {
  installManutencoesBridge,
  loadManutencoesIntoPanel,
} from './features/manutencoes/presentation/panel-bridge';
import {
  installFaturamentoBridge,
  loadFaturamentoIntoPanel,
} from './features/faturamento/presentation/panel-bridge';
import {
  installRotasBridge,
  loadRotasIntoPanel,
} from './features/rotas/presentation/panel-bridge';
import { installMapaBridge } from './features/mapa/presentation/panel-bridge';
import {
  installCustomersBridge,
  loadCustomersIntoPanel,
} from './features/customers/presentation/panel-bridge';
import {
  installPaymentsBridge,
  loadPaymentsIntoPanel,
} from './features/payments/presentation/panel-bridge';
import {
  installIncomeBridge,
  loadIncomeIntoPanel,
} from './features/income/presentation/panel-bridge';
import {
  installReceivablesBridge,
  loadReceivablesIntoPanel,
} from './features/receivables/presentation/panel-bridge';
import { bootstrapPanel } from './legacy/panel.js';
import type { User } from 'firebase/auth';

// Chaves de estado local do painel (hoje ele guarda os dados em localStorage).
const PANEL_STATE_KEYS = ['motoboy-front-etapa1-v2-clean'];
// Marca de quem é o dono dos dados locais atualmente no aparelho.
const OWNER_UID_KEY = 'motoboy-owner-uid';

/**
 * RD-05: um usuário nunca pode ver os dados do usuário anterior.
 * Como o painel ainda guarda estado em localStorage (global), garantimos o
 * isolamento por uid:
 *  - dono anterior é o mesmo uid  → mantém os dados;
 *  - primeiro dono (marca vazia)  → adota os dados existentes como dele;
 *  - dono diferente               → limpa os dados locais e recarrega limpo.
 * Retorna true quando fez uma limpeza que exige recarregar a página.
 */
function ensureLocalIsolation(uid: string): boolean {
  let previousOwner: string | null = null;
  try {
    previousOwner = localStorage.getItem(OWNER_UID_KEY);
  } catch {
    return false;
  }

  if (previousOwner === uid) return false;

  try {
    if (previousOwner !== null) {
      // Troca de usuário: apaga os dados locais do dono anterior.
      PANEL_STATE_KEYS.forEach((key) => localStorage.removeItem(key));
      localStorage.setItem(OWNER_UID_KEY, uid);
      return true; // recarrega para o painel reiniciar sem dados do anterior
    }
    // Primeiro login neste aparelho: adota o estado atual como deste usuário.
    localStorage.setItem(OWNER_UID_KEY, uid);
  } catch {
    /* se o storage falhar, seguimos sem isolamento local */
  }
  return false;
}

// Estado de boot (definido inline no index.html): cobre a tela enquanto a
// sessão é verificada. Removido no primeiro callback do observeAuth.
const appBoot = document.getElementById('appBoot');
function removeBoot(): void {
  appBoot?.remove();
}

// Pontes de persistência do painel legado (write-through para o Firestore).
installAbastecimentosBridge();
installManutencoesBridge();
installFaturamentoBridge();
installRotasBridge();
installMapaBridge();
installCustomersBridge();
installPaymentsBridge();
installIncomeBridge();
installReceivablesBridge();

// Etapa 1B: o painel só inicializa dentro de uma entrada autenticada única.
// O login NÃO é montado antes do primeiro estado da autenticação — assim quem
// já tem sessão válida não vê o login piscar. Até lá, o #appBoot cobre a tela.
let panelStarted = false;

/**
 * Entrada autenticada única. Inicializa o painel legado uma só vez, apenas para
 * usuário autenticado e verificado. As pontes já foram instaladas acima.
 */
function enterAuthenticatedApp(user: User): void {
  // Troca de usuário: sempre checa o UID atual ANTES da guarda, para que
  // panelStarted nunca impeça a detecção de troca de usuário.
  if (ensureLocalIsolation(user.uid)) {
    window.location.reload();
    return;
  }
  if (panelStarted) {
    removeBoot();
    return; // inicialização única por carregamento
  }
  // Só agora lemos o localStorage financeiro e renderizamos o painel.
  bootstrapPanel();
  panelStarted = true;
  // As pontes existem; agora carregamos os dados do dono no Firestore.
  void loadAbastecimentosIntoPanel();
  void loadManutencoesIntoPanel();
  void loadFaturamentoIntoPanel();
  void loadRotasIntoPanel();
  void loadCustomersIntoPanel();
  void loadPaymentsIntoPanel();
  void loadIncomeIntoPanel();
  void loadReceivablesIntoPanel();
  // Remove o login somente depois de o bootstrap ter sido iniciado.
  unmountLoginView();
  // Revela o painel (retira o estado de boot).
  removeBoot();
}

// RF-05 / RF-10 / RD-05.
observeAuth((user) => {
  if (isAuthenticated(user) && user) {
    enterAuthenticatedApp(user);
  } else if (panelStarted) {
    // Sessão terminada/perdida após o painel iniciar: recarrega para remover
    // dados renderizados, listeners e estado da memória (teardown por reload).
    window.location.reload();
  } else {
    // Nunca iniciou: monta o login e só então retira o estado de boot.
    mountLoginView();
    removeBoot();
  }
});

// RF-09: função de sair disponível para o painel.
// Enquanto o botão "Sair" não é adicionado ao menu, dá para encerrar a sessão
// chamando window.motoboyLogout() (ex.: pelo console).
declare global {
  interface Window {
    motoboyLogout: () => Promise<void>;
  }
}
window.motoboyLogout = logout;

// RF-09: botão "Sair" do menu do painel.
document.getElementById('logoutBtn')?.addEventListener('click', () => {
  // Fecha o menu (cosmético). Ao concluir o signOut, o observeAuth recarrega a
  // página (teardown). Se falhar, mantém o painel utilizável e avisa.
  document.getElementById('drawer')?.classList.remove('open');
  document.getElementById('backdrop')?.classList.remove('open');
  logout().catch(() => {
    showToast('Não foi possível sair agora. Verifique sua conexão e tente novamente.', {kind:'error'});
  });
});
