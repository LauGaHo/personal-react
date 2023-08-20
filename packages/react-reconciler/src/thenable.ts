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
			return thenable.value;

		// 經過了包裝，且狀態是 rejected
		case 'rejected':
			throw thenable.reason;

		default:
			if (typeof thenable.status === 'string') {
				thenable.then(noop, noop);
			} else {
				// 未經過包裝的 Thenable
				// untracked mode
				// pending mode
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
	throw SuspenseException;
}
