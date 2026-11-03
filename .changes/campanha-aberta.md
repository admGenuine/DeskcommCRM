---
impacto: nada_mudou
secao: alterado
titulo: A Prospecção passa a ter duas etapas, e cada campanha abre numa tela própria com mapa de bairros
---

Em CRM › Prospecção, a porta de entrada passa a ter dois botões: Prospecção (etapa 1, igual) e Campanha (etapa 2). A etapa 2 fica só com Suas campanhas e Acompanhar resultados. A lista de campanhas tem um filtro por situação (Todas, Rascunho, Andamento, Encerradas) e cada campanha ganhou o botão Abrir; os resultados mostram a análise das empresas (Analisar sites, Ler com IA, Procurar no Maps), a nota de 0 a 100 e a sua avaliação, e deixam de mostrar as colunas Informações e Sinais do site, que foram para a campanha aberta.

Abrir leva à tela própria da campanha, em `/app/prospecting/campanhas/<id>`, com um cabeçalho de números e duas abas. Preparar a campanha reúne o que já existia (nome, aviso da busca, referência do perfil ideal, ritmo, pausar e retomar) e, embaixo, as empresas achadas: um mapa de bairros pintado pela quantidade de empresas (por enquanto só Curitiba tem o desenho; em outra cidade aparece o ranking de bairros, lido do endereço), e a lista agrupada por bairro, cada empresa com nota, endereço, decisor, sinais do site e da IA, telefone, WhatsApp, site, Maps, e-mail, a conversa no Inbox e o botão que decide se ela entra na fila. Abordagem é a antiga etapa 3, sem mudança no que faz.

Nada muda nos dados, nas campanhas em andamento nem no que a IA faz. Links salvos para a antiga etapa 3 (`/app/prospecting/abordagem`) abrem a aba Abordagem da campanha, ou a etapa 2 quando não há campanha no link. Nenhuma ação é necessária.
