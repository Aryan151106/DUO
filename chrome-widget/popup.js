document.addEventListener('DOMContentLoaded', () => {
  const reactionButtons = document.querySelectorAll('.reaction-btn');
  const toast = document.getElementById('toast');
  const noteForm = document.getElementById('quick-note-form');
  const noteInput = document.getElementById('note-input');

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 2000);
  }

  reactionButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const emoji = btn.getAttribute('data-emoji');
      showToast(`Sent ${emoji} with love! 💕`);
    });
  });

  noteForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!noteInput.value.trim()) return;
    showToast('Love note sent! 💌');
    noteInput.value = '';
  });
});
