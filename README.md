# FUTURA AI — Portal empresarial (homologação)

Aplicação B2B para gestão financeira e administração da plataforma. Interface em português, servida por Cloudflare Workers e persistida em Cloudflare D1.

## Portal da empresa

- Acesso por e-mail e senha com sessão `HttpOnly`, `Secure` e `SameSite=Strict`; senhas derivadas com PBKDF2-SHA-256.
- Cadastros públicos aguardam validação do administrador antes de liberar o acesso.
- Dashboard de receitas, despesas, saldo líquido, histórico mensal e categorias.
- Na visão geral, análise setorial que cruza até seis meses de movimentações com notícias recentes, estima receitas, despesas, lucro e margem nos seis meses seguintes e recomenda ações; as notícias são citadas no próprio relatório.
- Filtro de movimentações para 30, 60 ou 90 dias, histórico completo ou intervalo personalizado, com resumo de faturamento, despesas, lucro líquido e margem.
- DRE gerencial por período, calculada a partir das categorias dos lançamentos, com receita bruta/líquida, custos diretos, despesas, resultado financeiro, lucro líquido estimado e margem. Usa a data de competência quando informada; na ausência, usa a data do lançamento e identifica essa limitação. A importação reconhece a coluna competência e a prévia mostra as duas datas. As classificações automáticas podem ser ajustadas por empresa e ficam na auditoria; o relatório não substitui escrituração por competência nem ajustes contábeis.
- Previsão de caixa em cenários conservador, base e otimista, calculada a partir das receitas e despesas dos últimos 3 ou 6 meses completos com movimentação registrada; saldo inicial, horizonte e taxas podem ser ajustados e ficam salvos por empresa.
- Importação de planilhas Excel `.xlsx`, CSV e TSV, com escolha da aba, linha de cabeçalho e associação das colunas. Planilhas `.xls` antigas devem ser convertidas para `.xlsx` ou CSV. A prévia mostra lançamentos e totais antes da confirmação. Suporta cabeçalhos em português ou inglês, até 500 lançamentos e gravação atômica. Reimportações repetidas ignoram lançamentos com a mesma data, tipo, valor e identificadores contábeis disponíveis; a interface informa quantos foram ignorados. Reconhece data, descrição/histórico e valor único ou colunas separadas de débito/crédito; categoria pode faltar. Guarda também conta contábil, código de conta, contraparte, centro de custo, documento, vencimento, pagamento, forma, status e observações quando presentes. Categorias inferidas ficam marcadas como sugestões para revisão.
- Inclusão, edição e exclusão manual de lançamentos. O sistema avisa quando a movimentação parece repetida e permite confirmar casos legítimos.
- Auditoria por empresa para importações, inclusões, edições, exclusões e limpeza do histórico, identificando usuário e horário.
- Administradores da empresa podem apagar todos os lançamentos após confirmação digitada; a auditoria preserva a quantidade e os totais apagados. Essa ação não remove os registros de auditoria.
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
- Editar o cadastro empresarial (CNPJ, razão social, endereço, contato e responsável) e classificar segmento abrangente/detalhado a partir de uma lista controlada.
- Aprovar ou rejeitar cadastros de usuários.
- Ativar, desativar ou redefinir a senha de usuários.
- Ativar ou suspender empresas.
- Consultar trilha de auditoria das ações administrativas.

A conta inicial de administração e as credenciais de teste são provisionadas diretamente no ambiente de homologação; não devem ser publicadas neste repositório.

## Homologação e segurança

O sistema está em homologação. Não inserir dados reais de clientes, colaboradores ou transações. As credenciais da conta demonstrativa pertencem somente a esta instância. Os valores de mensalidade precisam ser configurados pelo administrador. O envio transacional ainda depende de domínio remetente verificado e binding de e-mail habilitada na Cloudflare; sem isso, a cobrança manual abre um rascunho no aplicativo de e-mail e os lembretes automáticos ficam desabilitados. O acesso administrativo tem sessão própria e limite de tentativas de autenticação.

Ao abrir o painel da empresa, a análise setorial é solicitada automaticamente quando há segmento cadastrado. O código aplica limite de 50 chamadas diárias para toda a implantação e guarda o último relatório por empresa. Esse limite global é proteção de homologação, não uma política adequada para planos pagos. Notícias são consultadas via Google News RSS e apresentadas com link e data; o sistema usa títulos/fontes, não uma integração validada com dados completos de mercado.

## Rodar localmente

1. Instale Node.js e Wrangler 4.
2. Execute `npm install`.
3. Execute `npm run db:local`.
4. Execute `npm run dev`.

## Banco e publicação

O D1 de homologação está configurado no `wrangler.jsonc`. `schema.sql` cria as tabelas da aplicação, aprovação, sessões administrativas, trilhas de auditoria, perfis empresariais e controle/cache de previsões. As migrações em `migrations/` adicionam a auditoria e a deduplicação das movimentações, classificações da DRE e data de competência. A binding `AI` conecta o portal ao Workers AI. Para publicar após instalar as dependências, aplique `npm run db:remote` e use `npm run deploy`.

## Dados de demonstração

A conta empresarial de teste contém cinco lançamentos fictícios. O CSV `demo.csv` deve gerar receita de **R$ 1.301,10**, despesas de **R$ 300,25** e saldo líquido de **R$ 1.000,85**. Não importar dados reais nesta instância.

## Limites conhecidos

- A importação aceita até 500 linhas por arquivo. Arquivos `.xls` antigos precisam ser salvos como `.xlsx` ou CSV antes do envio. A deduplicação compara data, tipo, valor, descrição e identificadores contábeis; dois lançamentos verdadeiros sem identificadores diferentes podem parecer iguais. Nesses casos, confirme a duplicidade na inclusão manual e use documento, conta ou contraparte para diferenciá-los nos arquivos. Os mapeamentos de cabeçalho e as categorias sugeridas seguem regras heurísticas; revise classificações antes de usar em relatórios oficiais ou obrigações fiscais.
- Esta implantação não está homologada para operação comercial com dados reais. Antes disso, completar verificação de e-mail, recuperação de acesso, cobrança, revisão independente de segurança e validação ponta a ponta em navegador.
- A previsão da empresa estima entradas e saídas recorrentes com base na média histórica e nas taxas informadas. Não incorpora automaticamente contas a receber/pagar futuras ainda não lançadas, sazonalidade ou saldo bancário; o saldo inicial deve ser informado pela empresa.
- A previsão financeira administrativa é uma estimativa linear de receita recorrente baseada na base ativa, ticket médio e novos clientes mensais informados; não é uma garantia de vendas ou recebimentos.
- A previsão setorial é uma estimativa orientativa: projeções numéricas combinam a tendência recente dos lançamentos com ajustes limitados sugeridos pela IA, e podem não refletir sazonalidade, alterações locais ou notícias sem cobertura no feed. Exige segmento definido no cadastro e depende da disponibilidade do feed e do Workers AI. A acurácia ainda não foi medida por backtest.
- O limite de 50 chamadas é compartilhado por todas as empresas da homologação; não há quota por cliente ou plano. Crescer o número de empresas sem redesenhar esse controle pode limitar a atualização das análises.
- A tela de acesso público não tem checkout ativo. Os antigos valores de R$ 299, R$ 999 e R$ 2.499 foram retirados como oferta; consulte `ESTRATEGIA_COMERCIAL.md` para hipóteses de preço e gates de lançamento.
- A página `futura-ai.polsia.io` é uma publicação separada que ainda apresenta estados e promessas diferentes desta Worker. Consolidar uma única experiência pública é requisito antes de divulgar o produto.

## Direção comercial

Leia [`ESTRATEGIA_COMERCIAL.md`](ESTRATEGIA_COMERCIAL.md) para o posicionamento, o primeiro perfil de empresa a validar, as hipóteses de preço, a reconciliação da meta de ARR e os requisitos para lançamento comercial.
