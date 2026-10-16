# janela-contexto

Um mod para o Claude Code que mostra quanto da janela de contexto a conversa já ocupa.

- **No app desktop:** um chip no rodapé da caixa de texto mostra uma barra e a porcentagem. Clicar no chip abre, logo acima da caixa de texto, um cartão com os tokens usados, quanto falta para a compactação automática, a divisão por categoria e um botão **Compactar agora**.
- **No terminal:** a barra e a porcentagem aparecem no fim da linha de dicas, abaixo do prompt.

A barra é colorida por categoria, nas mesmas cores do `/context`. A porcentagem fica verde, amarela ou vermelha conforme o contexto se aproxima da compactação automática. Antes da primeira resposta de uma sessão, o mod mostra uma estimativa marcada com `~`.

O botão **Compactar agora** roda o `/compact` como se você tivesse digitado o comando, e só aparece entre turnos.

Requer o Claude Code 2.1.299 ou mais novo. O app desktop já traz essa versão. No terminal, atualize com `claude update`.

## Instalar

No prompt de uma sessão do Claude Code no terminal:

```
/plugin install janela-contexto --marketplace Tucelos/janela-contexto
```

Responda `y` para adicionar o marketplace e escolha o escopo de usuário.

Pelo terminal do sistema:

```bash
claude plugin install janela-contexto --marketplace Tucelos/janela-contexto
```

No app desktop, onde o `/plugin` não roda: clique no **+** ao lado da caixa de texto, depois em **Plugins**, **Add marketplace** com `Tucelos/janela-contexto`, e por fim em **Add plugin**.

### A partir de uma pasta

Quem recebeu esta pasta, por exemplo num `.zip`, instala assim:

```bash
claude plugin marketplace add <caminho-da-pasta>
claude plugin install janela-contexto@tuigg-mods --scope user
```

Numa sessão que já estava aberta, rode `/reload-plugins` para o mod aparecer.

## Desenvolver

```bash
claude plugin validate .
claude plugin test .
```
