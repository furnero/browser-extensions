console.log('[e621 Auto-DL Background] Service worker started');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[e621 Auto-DL Background] Message received:', message);
    
    if (message.action === 'download') {
        handleDownload(message).then((result) => {
            sendResponse({success: true, result: result});
        }).catch((error) => {
            console.error('[e621 Auto-DL Background] Download failed:', error);
            sendResponse({success: false, error: error.message});
        });
        return true;
    }
});

async function handleDownload(data) {
    try {
        console.log('[e621 Auto-DL Background] ===== STARTING DOWNLOAD =====');
        console.log('[e621 Auto-DL Background] URL:', data.url);
        console.log('[e621 Auto-DL Background] Filename:', data.filename);
        
        const permissions = await chrome.permissions.getAll();
        console.log('[e621 Auto-DL Background] Current permissions:', permissions);
        
        const downloadId = await chrome.downloads.download({
            url: data.url,
            filename: `e621_favorites/${data.filename}`,
            saveAs: false,
            conflictAction: 'uniquify'
        });
        
        console.log('[e621 Auto-DL Background] ===== DOWNLOAD STARTED =====');
        console.log('[e621 Auto-DL Background] Download ID:', downloadId);
        
        await chrome.storage.local.set({
            [`download_${downloadId}`]: {
                postId: data.postId,
                timestamp: Date.now(),
                filename: data.filename,
                url: data.url
            }
        });
        
        return downloadId;
        
    } catch (error) {
        console.error('[e621 Auto-DL Background] ===== DOWNLOAD ERROR =====');
        console.error('[e621 Auto-DL Background] Error details:', error);
        console.error('[e621 Auto-DL Background] Error name:', error.name);
        console.error('[e621 Auto-DL Background] Error message:', error.message);
        throw error;
    }
}

chrome.downloads.onChanged.addListener((delta) => {
    console.log('[e621 Auto-DL Background] Download changed:', delta);
    
    if (delta.state && delta.state.current === 'complete') {
        console.log(`[e621 Auto-DL Background] ✓ Download ${delta.id} completed successfully!`);
    }
    
    if (delta.error) {
        console.error(`[e621 Auto-DL Background] ✗ Download ${delta.id} failed:`, delta.error);
    }
});
