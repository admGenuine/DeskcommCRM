---
impacto: capacidade_nova
secao: adicionado
titulo: Campanhas pela API oficial do WhatsApp pulam sozinhas o modelo que a plataforma pausou ou recusou
---

Quando a plataforma recusa um envio porque o modelo está pausado, desativado ou não aprovado, a pessoa volta à fila e recebe o próximo modelo da lista, sem contar como falha. Só volta quem não recebeu nada, no máximo três vezes. Se nenhum modelo da lista estiver disponível, a campanha pausa e avisa na Central; quando um modelo volta a ficar aprovado, a campanha que o sistema pausou retoma sozinha.

Os modelos das contas oficiais passam a ser sincronizados a cada 10 minutos, e os avisos da plataforma sobre qualidade e categoria atualizam a lista de modelos. Qualidade baixa e modelo de Utilidade que passa a Marketing (que custa mais) geram aviso na Central. A tela da campanha mostra, em Resultado por modelo, quais modelos estão ativos, quais foram pulados e por quê.

Para receber os avisos de qualidade e de categoria numa conta conectada antes desta versão, assine os campos message_template_quality_update e template_category_update no webhook do aplicativo, no painel da Meta.
