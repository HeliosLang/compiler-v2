const src = `validator anchor

export SEED: Data

export main = (redeemer: Data) -> {
    ctx = sndPair(unConstrData(scriptContextData))
    tx = sndPair(unConstrData(headList(ctx)))

    redeemer_pair = unConstrData(redeemer)
    redeemer_tag = fstPair(redeemer_pair)

    if (equalsInteger(redeemer_tag, 0)) {
        if (spends_seed(unListData(headList(tx)))) {
            ()
        } else {
            error()
        }
    } else {
        // index of the state input/ref-input
        ptr_fields = sndPair(redeemer_pair)
        input_ptr = unIData(headList(ptr_fields))
        witness_ptr = unIData(headList(tailList(ptr_fields)))
        signer_ptr = unIData(headList(tailList(tailList(ptr_fields))))

        own_hash = get_own_hash(
            headList(tailList(tailList(ctx))),
            tx
        )

        inputs = unListData(
            if (equalsInteger(redeemer_tag, 1)) {
                headList(tx)
            } else {
                headList(tailList(tx))
            }
        )

        input = sndPair(unConstrData(get(inputs, input_ptr, 0)))
        input_output = sndPair(unConstrData(headList(tailList(input))))
        input_assets = unMapData(headList(tailList(input_output)))

        // make sure the input contains at least one state asset
        if (assets_contain(input_assets, own_hash)) {
            // now get the datum
            input_datum = unListData(headList(sndPair(unConstrData(headList(tailList(tailList(input_output)))))))

            witness = unConstrData(get(input_datum, witness_ptr, 0))
            witness_tag = fstPair(witness)

            if (equalsInteger(witness_tag, 0)) {
                // signed by PubKeyHash
                pkh = get(headList(tailList(tailList(tailList(tailList(tailList(tailList(tailList(tailList(tx))))))))), signer_ptr, 0)

                if (equalsData(pkh, headList(sndPair(witness)))) {
                    ()
                } else {
                    error()
                }
            } else {
                // witnessed by staking credential in withdrawal
                pair = get_pair(headList(tailList(tailList(tailList(tailList(tailList(tailList(tx))))))), signer_ptr, 0)

                if (equalsData(fstPair(pair), headList(sndPair(witness)))) {
                    ()
                } else {
                    error()
                }
            }

            // the input contains a list of witnesses
            assert_witnessed_by(witness, signer_ptr, tx)
        } else {
            error()
        }
    } 
}

spends_seed = (inputs: List[Data]): Bool -> {
    if (nullList(inputs)) {
        false
    } else if (equalsData(headList(sndPair(unConstrData(headList(inputs)))), SEED)) {
        true
    } else {
        spends_seed(tailList(inputs))
    }
}

get_own_hash = (purpose: Data, tx: List[Data]): Data -> {
    purpose_pair = unConstrData(purpose)
    purpose_tag = fstPair(purpose_pair)
    purpose_fields = sndPair(purpose_pair)

    if (equalsInteger(purpose_tag, 0)) {
        // minting
        headList(purpose_fields)
    } else if (equalsInteger(purpose_tag, 1)) {
        // spending validator credential
        input = find_input(unListData(headList(tx)), headList(purpose_fields))

        headList(sndPair(unConstrData(headList(sndPair(unConstrData(headList(sndPair(unConstrData(headList(tailList(input)))))))))))
    } else if (equalsInteger(purpose_tag, 2)) {
        // rewarding
        headList(sndPair(unConstrData(headList(sndPair(unConstrData(headList(purpose_fields)))))))
    } else if (equalsInteger(purpose_tag, 3)) {
        // certifying
        headList(sndPair(unConstrData(headList(sndPair(unConstrData(headList(purpose_fields)))))))
    } else {
        error()
    }
}

find_input = (inputs: List[Data], ref: Data): List[Data] -> {
    input = sndPair(unConstrData(headList(inputs)))

    if (equalsData(headList(input), ref)) {
        input
    } else {
        find_input(tailList(inputs), ref)
    }
}

get = (inputs: List[Data], index: Int, running_idx: Int): Data -> {
    if (equalsInteger(index, running_idx)) {
        headList(inputs)
    } else {
        get(inputs, index, addInteger(running_idx, 1))
    }
}

get_pair = (inputs: Map[Data, Data], index: Int, running_idx: Int): Pair[Data, Data] -> {
    if (equalsInteger(index, running_idx)) {
        headList(inputs)
    } else {
        get_pair(inputs, index, addInteger(running_idx, 1))
    }
}

assets_contain = (assets: Map[Data, Data], policy: Data): Bool {
    if (nullList(assets)) {
        false
    } else {
        entry = headList(assets)

        if (equalsData(fstPair(entry), policy)) {
            true
        } else {
            assets_contain(tailList(assets), policy)
        }
    }
}

witnesses = (witnesses: List[Data], tx: List[Data]) -> {
    witness = headList(witnesses)
}`