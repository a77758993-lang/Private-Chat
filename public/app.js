// متن دلخواهت را بین علامت‌های ` ` بنویس.
const MESSAGE = `الان بازش کردی کیر بخوری 😊😊😊😊😊`;

const form = document.getElementById('password-form');
const input = document.getElementById('password-input');
const messageScreen = document.getElementById('message-screen');
const messageBox = document.getElementById('custom-message');

form.addEventListener('submit', (event) => {
  event.preventDefault();
  // رمز بررسی نمی‌شود؛ هر چیزی وارد شود پذیرفته می‌شود.
  document.querySelector('.panel').hidden = true;
  messageBox.textContent = MESSAGE;
  messageScreen.hidden = false;
});
