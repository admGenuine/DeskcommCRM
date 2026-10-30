---
impacto: nada_mudou
secao: alterado
titulo: A aparência padrão do sistema passa a ser a identidade Radar — preto, tipografia Host Grotesk, botões e campos em pílula — e o logo enviado com margem transparente deixa de aparecer minúsculo
---

A cor padrão do produto deixa de ser o verde-sálvia e passa a ser um preto com um fio de azul (`#0b0c1e`): no tema claro os botões e o item ativo do menu ficam pretos com texto branco; no tema escuro o sistema sobe o tom para um cinza claro, para o botão não sumir no fundo. A fonte de todas as telas passa a ser a Host Grotesk (versionada no repositório, sem download durante o build), com espaçamento de letras um pouco mais fechado. Botões, campos de uma linha e seletores ficam com cantos totalmente arredondados; caixas de texto e cartões seguem como estavam.

Quem configurou uma cor própria em Admin › Marca ou em Configurações › Marca não vê mudança nos botões — a cor configurada continua valendo. Quem tinha deixado a cor em branco, ou escolhido um preto/cinza puro (que o sistema reserva ao logo), passa a ver o preto da identidade Radar no lugar do verde.

Ao enviar um logo em PNG com volta transparente grande (exportado da prancheta inteira), a tela agora recorta essa margem antes de enviar, mesmo quando o arquivo já cabe nos 512 KB — antes isso só acontecia quando o arquivo passava do limite, e o logo que cabia subia com a margem e aparecia como um selo minúsculo na barra lateral. Margem pequena (menos de 20% em cada lado) é preservada. Nenhuma ação é necessária.
