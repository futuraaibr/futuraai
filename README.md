# FUTURA AI — Portal empresarial (homologação)

Aplicação B2B para gestão financeira e administração da plataforma. Interface em português, servida por Cloudflare Workers e persistida em Cloudflare D1.

## Portal da empresa

- Acesso por e-mail e senha com sessão `HttpOnly`, `Secure` e `SameSite=Strict`; senhas derivadas com PBKDF2-SHA-256.
- Cadastros públicos aguardam validação do administrador antes de liberar o acesso.
- Dashboard de receitas, despesas, saldo líquido, histórico mensal e categorias.
- Previsão de caixa em cenários conservador, base e otimista, calculada a partir das receitas e despesas dos últimos 3 ou 6 meses completos com movimentação registrada; saldo inicial, horizonte e taxas podem ser ajustados e ficam salvos por empresa.
- Importação CSV `data;descricao;tipo;valor;categoria`, com limite de 100 linhas e gravação atômica.
- Área da empresa e consulta da equipe aprovada.
- CSV de demonstração exclusivamente fictício.

## Portal do administrador

Acesse `/admin`. Não existe cadastro público de administradores. O painel permite:

- Ver empresas, usuários, pendências e movimentações administrativas.
- Acompanhar mensalidades, vencimentos e pagamentos por empresa; registrar recebimentos e preparar cobranças manuais.
- Configurar lembretes automáticos de vencimento, condicionados à configuração de um remetente de e-mail transacional verificado.
- Definir meta de receita recorrente, ticket médio e novos clientes mensais; comparar previsões conservadora, base e otimista.
- Registrar e consultar receitas e despesas próprias do projeto FUTURA AI, com resumo mensal e trilha de auditoria.
- Cadastrar empresa e responsável, com senha temporária mostrada uma única vez.
- Aprovar ou rejeitar cadastros de usuários.
- Ativar, desativar ou redefinir a senha de usuários.
- Ativar ou suspender empresas.
- Consultar trilha de auditoria das ações administrativas.

A conta inicial de administração e as credenciais de teste são provisionadas diretamente no ambiente de homologação; não devem ser publicadas neste repositório.

## Homologação e segurança

O sistema está em homologação. Não inserir dados reais de clientes, colaboradores ou transações. As credenciais da conta demonstrativa pertencem somente a esta instância. Os valores de mensalidade precisam ser configurados pelo administrador. O envio transacional ainda depende de domínio remetente verificado e binding de e-mail habilitada na Cloudflare; sem isso, a cobrança manual abre um rascunho no aplicativo de e-mail e os lembretes automáticos ficam desabilitados. O acesso administrativo tem sessão própria e limite de tentativas de autenticação.

## Rodar localmente

1. Instale Node.js e Wrangler 4.
2. Execute `npm install`.
3. Execute `npm run db:local`.
4. Execute `npm run dev`.

## Banco e publicação

O D1 de homologação está configurado no `wrangler.jsonc`. `schema.sql` cria as tabelas da aplicação, aprovação, sessões administrativas e auditoria. Para publicar após instalar as dependências, aplique `npm run db:remote` e use `npm run deploy`.

## Dados de demonstração

A conta empresarial de teste contém cinco lançamentos fictícios. O CSV `demo.csv` deve gerar receita de **R$ 1.301,10**, despesas de **R$ 300,25** e saldo líquido de **R$ 1.000,85**. Não importar dados reais nesta instância.

## Limites conhecidos

- A importação CSV aceita até 100 linhas por arquivo.
- Esta implantação não está homologada para operação comercial com dados reais. Antes disso, completar verificação de e-mail, recuperação de acesso, cobrança, revisão independente de segurança e validação ponta a ponta em navegador.
- A previsão da empresa estima entradas e saídas recorrentes com base na média histórica e nas taxas informadas. Não incorpora automaticamente contas a receber/pagar futuras ainda não lançadas, sazonalidade ou saldo bancário; o saldo inicial deve ser informado pela empresa.
- A previsão financeira administrativa é uma estimativa linear de receita recorrente baseada na base ativa, ticket médio e novos clientes mensais informados; não é uma garantia de vendas ou recebimentos.
