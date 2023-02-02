// 这里的 Tag 指代的是在 Effect 实体对象中的 tag 字段，用于区分 useEffect、useLayoutEffect、useInsertionEffect
// 指代 useEffect
export const Passive = 0b0010;
// 对于 EffectHook，HookHasEffect 代表当前 effect 本次更新存在副作用需要执行
export const HookHasEffect = 0b0001;
