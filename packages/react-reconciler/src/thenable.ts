import {
	FulfilledThenable,
	PendingThenable,
	RejectedThenable,
	Thenable
} from 'shared/ReactTypes';

export const SuspenseException = new Error(
	'這不是真實的錯誤，是 Suspense 工作的一部分，如果你捕獲到這個錯誤，請將它繼續跑出去'
);

let suspenseThenable: Thenable<any> | null = null;

/**
 * 獲取 Suspense 組件對應的 Thenable
 *
 * @throws {Error} - 拋出不存在 suspenseThenable 報錯
 * @returns {Thenable<any>} 返回當前正在處理的 suspenseThenable 對象
 */
export function getSuspenseThenable(): Thenable<any> {
	if (suspenseThenable === null) {
		throw new Error('應該存在 suspenseThenable，這是個 bug');
	}
	const thenable = suspenseThenable;
	// 置空变量，因为这里只需要取一遍
	suspenseThenable = null;
	return thenable;
}

/**
 * 什麼都不做回調函數
 *
 */
// eslint-disable-next-line @typescript-eslint/no-empty-function
function noop() {}

/**
 * 將 Promise 包裝成一個 Thenable 實例對象
 *
 * @template T - 泛型 T
 * @param {Thenable<T>} thenable - 傳入的 Promise 對象
 * @throws {Err} - thenable 的 rejected 的錯誤對象
 * @throws {SuspenseException} - 不是 Suspense 的參數的錯誤類型
 * @returns {any} 包裝後的 Thenable 對象
 */
export function trackUsedThenable<T>(thenable: Thenable<T>): any {
	switch (thenable.status) {
		// 經過了包裝，且狀態是 fulfilled
		case 'fulfilled':
			// 只要这里是 fulfilled 状态，那么就会直接返回 value，不会执行该函数最后一行抛出错误
			return thenable.value;

		// 經過了包裝，且狀態是 rejected
		case 'rejected':
			// 只要这里是 rejected 状态，那么就会直接抛出 rejected 对应的 reason，不会执行该函数最后一行抛出 Suspense 的 Exception
			throw thenable.reason;

		default:
			if (typeof thenable.status === 'string') {
				// 已经经过包装了
				thenable.then(noop, noop);
			} else {
				// 未經過包裝的 Thenable 应该属于 untracked status
				// 所以这里我们应该要将其变成 pending status
				const pending = thenable as unknown as PendingThenable<T, void, any>;
				pending.status = 'pending';
				pending.then(
					(val) => {
						if (pending.status === 'pending') {
							// @ts-ignore
							const fulfilled: FulfilledThenable<T, void, any> = pending;
							fulfilled.status = 'fulfilled';
							fulfilled.value = val;
						}
					},
					(err) => {
						if (pending.status === 'pending') {
							// @ts-ignore
							const rejected: RejectedThenable<T, void, any> = pending;
							rejected.status = 'rejected';
							rejected.reason = err;
						}
					}
				);
			}
			break;
	}
	suspenseThenable = thenable;
	// 这里抛出的错误是为了能够打断正常的 render 流程
	throw SuspenseException;
}
