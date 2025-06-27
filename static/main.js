// static/main.js

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const chatForm = document.getElementById('chat-form');
    const questionInput = document.getElementById('question-input');
    const chatContainer = document.getElementById('chat-container');
    const imageUpload = document.getElementById('image-upload');
    const imagePreviewContainer = document.getElementById('image-preview-container');
    const imagePreview = document.getElementById('image-preview');
    const imagePlaceholder = document.getElementById('image-placeholder');
    const typingIndicator = document.getElementById('typing-indicator-container');
    const exampleButtons = document.querySelectorAll('.example-btn');
    // [THÊM MỚI] Lấy các element cho chức năng mới
    const dropZone = document.getElementById('drop-zone');
    const cancelImageBtn = document.getElementById('cancel-image-btn');

    let currentImageFile = null;

    // --- Event Listeners ---
    imageUpload.addEventListener('change', handleImageUpload);
    chatForm.addEventListener('submit', handleFormSubmit);
    exampleButtons.forEach(button => button.addEventListener('click', handleExampleClick));
    // [THÊM MỚI] Event listener cho nút hủy ảnh
    cancelImageBtn.addEventListener('click', handleCancelImage);
    
    // [THÊM MỚI] Event listeners cho chức năng Kéo và Thả
    ;['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false); // Ngăn trình duyệt mở file khi thả ra ngoài
    });
    ;['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, highlight, false);
    });
    ;['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, unhighlight, false);
    });
    dropZone.addEventListener('drop', handleDrop, false);


    // --- Functions ---
    
    /**
     * [THÊM MỚI] Hàm xử lý file ảnh chung
     * @param {File} file Đối tượng file ảnh
     */
    function processImageFile(file) {
        if (!file || !file.type.startsWith('image/')) {
            alert('Vui lòng chỉ tải lên file hình ảnh (jpg, png, gif, ...).');
            return;
        }
        
        currentImageFile = file;
        const reader = new FileReader();
        reader.onload = (e) => {
            imagePreview.src = e.target.result;
            imagePreviewContainer.classList.remove('hidden');
            imagePlaceholder.classList.add('hidden');
            clearChat();
            addMessage('bot', 'Ảnh đã được tải lên. Bây giờ bạn có thể đặt câu hỏi.');
        };
        reader.readAsDataURL(file);
    }

    /**
     * Xử lý khi người dùng chọn ảnh bằng cách nhấp chuột.
     */
    function handleImageUpload(event) {
        const file = event.target.files[0];
        processImageFile(file);
    }
    
    /**
     * [THÊM MỚI] Xử lý khi người dùng hủy ảnh đã chọn.
     */
    function handleCancelImage() {
        currentImageFile = null;
        imagePreview.src = '#'; // Xóa src để giải phóng bộ nhớ
        imageUpload.value = ''; // Reset input để có thể chọn lại cùng 1 file
        
        imagePreviewContainer.classList.add('hidden');
        imagePlaceholder.classList.remove('hidden');
        
        clearChat();
        addMessage('bot', 'Đã hủy ảnh. Vui lòng tải lên một ảnh mới.');
    }

    /**
     * Tải ảnh và câu hỏi ví dụ.
     */
    async function handleExampleClick(event) {
        const button = event.currentTarget;
        const imageUrl = button.dataset.img;
        const question = button.dataset.q;

        try {
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            const filename = imageUrl.split('/').pop();
            const file = new File([blob], filename, { type: blob.type });
            processImageFile(file); // Dùng hàm xử lý chung
            questionInput.value = question;
            questionInput.focus();

        } catch (error) {
            console.error('Lỗi tải ảnh ví dụ:', error);
            addMessage('error', 'Không thể tải hình ảnh ví dụ. Vui lòng kiểm tra console.');
        }
    }

    /**
     * Xử lý gửi form chat.
     */
    async function handleFormSubmit(event) {
        event.preventDefault();
        const question = questionInput.value.trim();

        if (!question) {
            alert('Vui lòng nhập một câu hỏi.');
            return;
        }
        if (!currentImageFile) {
            alert('Vui lòng tải ảnh lên trước.');
            return;
        }

        addMessage('user', question);
        questionInput.value = '';
        showTypingIndicator();

        const formData = new FormData();
        formData.append('question', question);
        formData.append('image', currentImageFile);

        try {
            const response = await fetch('/vqa', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || `Lỗi máy chủ: ${response.status}`);
            }

            const data = await response.json();
            addMessage('bot', data.answer);

        } catch (error) {
            console.error('Lỗi:', error);
            addMessage('error', `Đã xảy ra lỗi: ${error.message}`);
        } finally {
            hideTypingIndicator();
        }
    }
    
    // --- Các hàm tiện ích ---

    /**
     * Thêm tin nhắn vào khung chat.
     */
    function addMessage(role, text) {
        const messageWrapper = document.createElement('div');
        const messageBubble = document.createElement('div');
        messageBubble.textContent = text;
        let wrapperClasses = 'flex';
        let bubbleClasses = 'p-3 rounded-lg max-w-lg break-words'; // Thêm break-words

        if (role === 'user') {
            wrapperClasses += ' justify-end';
            bubbleClasses += ' bg-blue-500 text-white';
        } else if (role === 'bot') {
            wrapperClasses += ' justify-start';
            bubbleClasses += ' bg-gray-200 text-gray-800';
        } else { // error
            wrapperClasses += ' justify-start';
            bubbleClasses += ' bg-red-100 text-red-700 border border-red-300';
        }

        messageWrapper.className = wrapperClasses;
        messageBubble.className = bubbleClasses;
        messageWrapper.appendChild(messageBubble);
        chatContainer.appendChild(messageWrapper);
        scrollToBottom();
    }

    /** Xóa tất cả tin nhắn. */
    function clearChat() {
        chatContainer.innerHTML = '';
    }

    /** Hiện chỉ báo đang chờ. */
    function showTypingIndicator() {
        typingIndicator.classList.remove('hidden');
        questionInput.disabled = true;
        chatForm.querySelector('button').disabled = true;
        scrollToBottom();
    }

    /** Ẩn chỉ báo đang chờ. */
    function hideTypingIndicator() {
        typingIndicator.classList.add('hidden');
        questionInput.disabled = false;
        chatForm.querySelector('button').disabled = false;
        questionInput.focus();
    }

    /** Cuộn xuống cuối khung chat. */
    function scrollToBottom() {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    // --- [THÊM MỚI] Các hàm cho Kéo và Thả ---

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    function highlight() {
        dropZone.classList.add('drag-over');
    }

    function unhighlight() {
        dropZone.classList.remove('drag-over');
    }

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const file = dt.files[0];
        processImageFile(file); // Dùng hàm xử lý chung
    }
});