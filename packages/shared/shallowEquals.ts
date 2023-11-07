/**
 * 两个值的浅比较
 *
 * @param {any} a - a 值
 * @param {any} b - b 值
 * @returns {boolean} 返回是否相等
 */
export function shallowEqual(a: any, b: any): boolean {
	// 基本数据类型比较
	if (Object.is(a, b)) {
		return true;
	}

	// 尝试浅比较
	if (
		typeof a !== 'object' ||
		a === null ||
		typeof b !== 'object' ||
		b === null
	) {
		// 其中一个为 null 值返回 false
		// 其中一个不为 object 类型，返回 false
		return false;
	}

	const keysA = Object.keys(a);
	const keysB = Object.keys(b);

	if (keysA.length !== keysB.length) {
		return false;
	}

	for (let i = 0; i < keysA.length; i++) {
		const key = keysA[i];
		// b 没有对应的 key 或者 key 不相等
		if (!{}.hasOwnProperty.call(b, key) || !Object.is(a[key], b[key])) {
			return false;
		}
	}

	return true;
}
