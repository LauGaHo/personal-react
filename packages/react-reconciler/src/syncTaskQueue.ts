// 记录调度阶段中存在多少个任务，一个任务对应一个回调函数
let syncQueue: ((...args: any) => void)[] | null = null;
// 记录当前是否正在进行刷新、清空执行 syncQueue 队列
let isFlushingSyncQueue = false;

// 调度任务阶段，将传入的回调函数存储在 syncQueue 数组中
export function scheduleSyncCallback(callback: (...args: any) => void) {
	if (syncQueue === null) {
		syncQueue = [callback];
	} else {
		syncQueue.push(callback);
	}
}

// 刷新、清空执行 syncQueue 数组
export function flushSyncCallbacks() {
	if (!isFlushingSyncQueue && syncQueue) {
		// 将 isFlushingSyncQueue 变量设置为 true，表示正在进行刷新 syncQueue 数组操作
		isFlushingSyncQueue = true;
		try {
			// 遍历 syncQueue 数组，并逐一执行
			syncQueue.forEach((callback) => callback());
		} catch (e) {
			if (__DEV__) {
				console.error('flushSyncCallbacks 报错', e);
			}
		} finally {
			isFlushingSyncQueue = false;
			syncQueue = null;
		}
	}
}
