// Modelos de mensagem do WhatsApp (iguais aos que a tela de Mensagens mostra). Variáveis: 1 nome, 2 dia, 3 hora, 4 serviço, 5 salão.
const EXEMPLO = ['Maria', '12/11', '10:00', 'Escova', 'Salão Bela'];
const MODELOS = [
  { name: 'lembrete_agendamento', texto: 'Olá, {{1}}! Lembrete do seu horário: {{2}} às {{3}}, serviço {{4}}, no {{5}}. Até lá!' },
  { name: 'pedido_aceito', texto: 'Olá, {{1}}! Seu pedido de horário foi aceito: {{2}} às {{3}}, serviço {{4}}, no {{5}}. Te esperamos!' },
  { name: 'pedido_recusado', texto: 'Olá, {{1}}! Não conseguimos confirmar o horário pedido para {{2}} às {{3}}, serviço {{4}}, no {{5}}. Escolha outro horário pelo nosso link.' }
];
function corpo(m) {
  return { name: m.name, language: 'pt_BR', category: 'UTILITY', components: [{ type: 'BODY', text: m.texto, example: { body_text: [EXEMPLO] } }] };
}
module.exports = { MODELOS, corpo };
