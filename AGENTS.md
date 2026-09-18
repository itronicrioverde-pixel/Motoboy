# Regras do projeto Motoboy

## Fluxo de trabalho

- Antes de alterar arquivos, examine o código atual e o git status.
- Não sobrescreva alterações existentes sem autorização.
- Não implemente várias etapas de arquitetura no mesmo commit.
- Cada etapa deve preservar o visual e o comportamento existente.
- Não executar deploy do Firebase sem autorização.
- Não alterar regras do Firestore sem apresentar a mudança primeiro.
- Não apagar dados locais nem criar migrações destrutivas.
- Sempre executar build e verificação TypeScript antes de concluir.
- Informar todos os arquivos alterados e testes realizados.

## Arquitetura

- Utilizar TypeScript em código novo.
- Organizar funcionalidades por feature.
- Domain não pode importar Firebase, DOM ou localStorage.
- Application deve depender de interfaces, não de implementações.
- Infrastructure implementa Firebase, Firestore, APIs e armazenamento.
- Presentation contém HTML, CSS, controladores e eventos.
- Evitar novas variáveis e funções globais em window.
- As pontes window.__motoboy são temporárias e devem ser removidas gradualmente.
- O index.html deve caminhar para ser somente a casca da aplicação.

## Segurança e dados

- Nunca salvar senhas no localStorage.
- Cada usuário deve acessar apenas seus próprios dados.
- Nenhum erro de autenticação deve revelar se um e-mail existe.
- Operações financeiras não devem ser apagadas definitivamente.
- Valores monetários devem futuramente ser armazenados em centavos.
- Erros de persistência não podem ser ignorados silenciosamente.

## Registro de decisões arquiteturais

- Antes de propor uma mudança estrutural, leia `docs/architecture/DECISIONS.md`.
- Toda decisão nova que afete arquitetura, dados, segurança, dependências ou infraestrutura deve ser registrada.
- Antes de registrar uma decisão, apresente a proposta e aguarde aprovação.
- Depois da aprovação, adicione uma nova decisão usando o próximo número disponível.
- Nunca apague decisões anteriores.
- Se uma decisão antiga deixar de valer, marque-a como `Substituída` e informe qual decisão a substituiu.
- Ao concluir cada tarefa, informe obrigatoriamente:
  - `Nova decisão arquitetural: Sim ou Não`.
  - Se sim, qual registro foi criado ou atualizado.