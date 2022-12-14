interface GoErr extends Error {
    code: string;
}
const enosys = () => {
    const err = new Error("not implemented") as GoErr;
    err.code = "ENOSYS";
    return err;
};

export default enosys;
