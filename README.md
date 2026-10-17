# FUTURA AI — Portal empresarial (homologação)

Aplicação B2B para acompanhamento de receitas, despesas, dashboards financeiros e projeções. Interface em português, sem dependências externas, servida por Cloudflare Workers e persistida em Cloudflare D1.

## O que já funciona

- Criação de conta da empresa e acesso por e-mail e senha.
- Sessão opaca em cookie `HttpOnly`, `Secure` e `SameSite=Strict`; senhas derivadas com PBKDF2-SHA-256.
- Separação de dados por `tenant_id` em todas as consultas financeiras e de cenários.
- Importação CSV no formato `data;descricao;tipo;valor;categoria` (até 100 linhas por importação).
- Dashboard com receitas, despesas, saldo líquido, histórico mensal e categorias.
- Cenários com crescimento mensal composto e horizonte de 3, 6 ou 12 meses.
- Área da empresa e consulta da equipe cadastrada.
- CSV de demonstração somente com dados fictícios.

## Homologação

O sistema está em homologação. Não inserir dados reais de clientes, colaboradores ou transações. O cadastro ainda não tem verificação de e-mail, recuperação de senha, cobrança, envio de convites ou painel de superadministrador. Os preços exibidos são apenas referências e não existe processamento de pagamentos.

## Rodar localmente

1. Instale Node.js e Wrangler 4.
2. Execute `npm install`.
3. Execute `npm run db:local`.
4. Execute `npm run dev`.

## Publicação Cloudflare

O banco D1 de homologação já está configurado no `wrangler.jsonc`. Para publicar após instalar as dependências, aplique `schema.sql` no D1 remoto e use `npm run deploy`. Confirme `/api/health`, cadastro, login, persistência, importação e isolamento entre duas empresas sintéticas.

## Validação financeira de referência

O arquivo `demo.csv` deve gerar receita total de **R$ 1.301,10**, despesas de **R$ 300,25** e saldo líquido de **R$ 1.000,85**. Todos os cinco registros são fictícios.

## Limites conhecidos

- A projeção aplica somente crescimento mensal composto ao saldo líquido importado; não considera impostos, sazonalidade, inflação ou compromissos futuros.
- Cada importação CSV tem limite de 100 linhas e é persistida atomicamente.
- A criação aberta de contas e a autenticação estão adequadas apenas à homologação inicial. Endurecer a política de cadastro, recuperação de acesso, rate limiting e revisão de segurança antes de operação com dados reais.
