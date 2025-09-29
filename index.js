const passwordForm = document.getElementById('password-form');
const submitBtn = document.getElementById('submit-btn');

submitBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const passwordInput = document.getElementById('password').value.trim();

    if (passwordInput === 'thehackstrikesback') {
        window.location.href = 'call.html';
        alert('Welcome to the secret page!');
    } else {
        alert('Incorrect password. Try again!');
    }
});