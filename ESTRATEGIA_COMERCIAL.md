# FUTURA AI — Direção comercial e critérios para lançamento

**Status:** plano de validação; não é oferta ao público nem autorização para cobrança.

## Decisão de posicionamento

Vender a FUTURA AI como ferramenta de **planejamento financeiro e decisão**, não como ERP ou previsão garantida. O fluxo prometido é simples: importar movimentações, entender o resultado do período, comparar cenários e avaliar ações sugeridas com evidências e premissas visíveis.

### Primeiro público a validar

Começar por empresas de serviços recorrentes com 1 a 20 pessoas, que já exportam o financeiro para CSV e não dependem de estoque/PDV para fechar o caixa. Esse grupo permite testar a utilidade do fluxo de caixa e dos cenários sem exigir integrações que ainda não existem. Varejo, bares e indústria ficam para uma etapa posterior, depois de validar sazonalidade, estoque, recebíveis e fontes de custos específicas.

## Preço: hipótese para pesquisa, não preço publicado

Retirar por ora a tabela antiga de R$ 299, R$ 999 e R$ 2.499: o produto não tem pagamento habilitado nem escopo comercial comprovado para sustentar esses degraus.

Testar, em entrevistas e propostas de piloto, três âncoras mensais por empresa:

| Hipótese | Faixa para testar | O que precisa estar comprovado antes de vender |
|---|---:|---|
| Essencial | R$ 99–149 | CSV confiável, indicadores reconciliados, histórico, suporte básico |
| Planejamento | R$ 199–299 | Cenários salvos, análise setorial útil, fontes e premissas rastreáveis, equipe |
| Acompanhado | R$ 499–799 | Além do software, revisão humana periódica e plano de ação; não oferecer antes de existir capacidade operacional para entregar o serviço |

Fazer entrevistas de disposição a pagar com pelo menos 15 empresas (5 por segmento testado), apresentar uma única oferta concreta por entrevista e registrar o preço aceito, objeções, urgência e alternativa atual. Não tratar elogio ou interesse em teste gratuito como validação de compra. Começar por um piloto acompanhado sem cobrança automática; só oferecer pagamento depois que o fluxo real e a proposta estiverem comprovados.

### Compatibilidade com a meta financeira

A meta anterior de R$ 1.144.620 de ARR com 115 empresas exige receita média aproximada de **R$ 829 por empresa/mês**. As faixas de entrada acima não alcançam essa meta sozinhas. Para mantê-la, a empresa precisará provar um segmento de maior valor, vender serviço acompanhado e/ou acrescentar integrações e ganhos operacionais que justifiquem tíquete maior; não elevar o preço sem esse valor demonstrado.

## Gates para aceitar clientes pagantes

### Produto e resultado

- Importação CSV testada ponta a ponta com arquivos válidos, inválidos, duplicados e limites; totais reconciliados em centavos.
- Fluxo demonstrativo para a empresa: cadastro/aprovação, login, importação, filtro, indicadores, cenários persistidos e exportação/remoção.
- Previsões exibem período de referência, premissas, incerteza, fontes e data; backtest em dados históricos e relatório de erro antes de usar a palavra “previsão” em promessa comercial.
- Recomendações de mercado citam link/data/fonte e separam evidência de hipótese; notícia sem impacto comprovável não vira instrução financeira.
- Experiência móvel, acessibilidade básica, estados vazios e erros recuperáveis conferidos em navegador real.

### Segurança, privacidade e operação

- Testes de isolamento entre empresas para cada rota, autorização e arquivo importado; revisão independente de segurança e teste de recuperação de backup.
- Fluxo de verificação de e-mail e recuperação de senha; política de sessão, limites de tentativas, auditoria e resposta a incidente revisados.
- Aviso de privacidade, termos, bases legais, retenção/exclusão e canal do titular revisados antes de coletar dados reais. Dados financeiros empresariais também serão tratados como confidenciais.
- Ambientes separados de homologação e produção, observabilidade, alertas, suporte, rotina de atualização e plano de continuidade.
- Limites de inferência por empresa e por plano, custo medido e proteção contra saturação da cota global. O limite atual é global para a implantação e não serve como política comercial.

### Cobrança e venda

- Definição final de planos, limites e preço após piloto pago/entrevistas.
- Integração de assinatura com checkout, cobrança recorrente, falha de pagamento, nota/recibo conforme a operação, cancelamento e histórico do cliente.
- E-mails de onboarding e cobrança com domínio verificado; lembretes testados sem enviar duplicatas.
- Política de cancelamento, suporte, disponibilidade e contrato claros no site; botão de compra só aparece quando cobrança e entrega foram homologadas.

## Estado verificado em 17/10/2026

- A página pública de homologação exibe os avisos de teste e não habilita cobrança.
- O código contém fluxos de movimentações, cenários, oportunidades/análise setorial e administração, mas isso não substitui teste ponta a ponta de uma empresa autenticada.
- O binding e remetente de e-mail transacional não estão configurados no `wrangler.jsonc`; lembretes automáticos não estão aptos para produção.
- A versão publicada em `futura-ai.polsia.io` é separada da Worker de homologação e declara que importação, previsões, cenários e IA não estão disponíveis. Essa divergência precisa ser resolvida antes de qualquer campanha ou venda.
- Não liberar dados reais nem anunciar funcionalidade como disponível enquanto o ambiente comercial não passar pelos gates acima.

## Próxima ordem de execução

1. Consolidar uma única versão pública e remover promessas/preços divergentes.
2. Homologar todos os fluxos com dados sintéticos e provar isolamento por empresa.
3. Corrigir onboarding, privacidade, recuperação de acesso e suporte.
4. Executar piloto assistido com 5 empresas do primeiro segmento e medir uso/decisões tomadas.
5. Testar disposição a pagar e só então finalizar os planos e integrar cobrança.
6. Revisar segurança e lançar produção gradualmente.
