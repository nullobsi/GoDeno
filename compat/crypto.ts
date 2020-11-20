
let compatCrypto = {
    getRandomValues(b: Uint8Array) {
        return crypto.getRandomValues(b)
    }
}

export default compatCrypto;