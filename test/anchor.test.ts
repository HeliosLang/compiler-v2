import { describe, expect, it } from "bun:test"
import { compile } from "../src/index.js"

const src = `validator anchor

export SEED: Data

export main = (redeemer: Data) -> {
    ctx = sndPair[Int,List[Data]](unConstrData(scriptContextData))
    tx = sndPair[Int,List[Data]](unConstrData(headList(ctx)))

    redeemer_pair = unConstrData(redeemer)
    redeemer_tag = fstPair[Int,List[Data]](redeemer_pair)

    if (equalsInteger(redeemer_tag, 0)) {
        if (spends_seed(unListData(headList(tx)))) {
            ()
        } else {
            error()
        }
    } else {
        // index of the state input/ref-input
        ptr_fields = sndPair[Int,List[Data]](redeemer_pair)
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

        input = sndPair[Int,List[Data]](unConstrData(get(inputs, input_ptr, 0)))
        input_output = sndPair[Int,List[Data]](unConstrData(headList(tailList(input))))
        input_assets = unMapData(headList(tailList(input_output)))

        // make sure the input contains at least one state asset
        if (assets_contain(input_assets, own_hash)) {
            // now get the datum
            input_datum = unListData(headList(sndPair[Int,List[Data]](unConstrData(headList(tailList(tailList(input_output)))))))

            witness = unConstrData(get(input_datum, witness_ptr, 0))
            witness_tag = fstPair[Int,List[Data]](witness)

            if (equalsInteger(witness_tag, 0)) {
                // signed by PubKeyHash
                pkh = get(unListData(headList(tailList(tailList(tailList(tailList(tailList(tailList(tailList(tailList(tx)))))))))), signer_ptr, 0)

                if (equalsData(pkh, headList(sndPair[Int,List[Data]](witness)))) {
                    ()
                } else {
                    error()
                }
            } else {
                // witnessed by staking credential in withdrawal
                pair = get_pair(unMapData(headList(tailList(tailList(tailList(tailList(tailList(tailList(tx)))))))), signer_ptr, 0)

                if (equalsData(fstPair[Data,Data](pair), headList(sndPair[Int,List[Data]](witness)))) {
                    ()
                } else {
                    error()
                }
            }
        } else {
            error()
        }
    } 
}

spends_seed = (inputs: List[Data]): Bool -> {
    if (nullList(inputs)) {
        false
    } else if (equalsData(headList(sndPair[Int,List[Data]](unConstrData(headList(inputs)))), SEED)) {
        true
    } else {
        spends_seed(tailList(inputs))
    }
}

get_own_hash = (purpose: Data, tx: List[Data]): Data -> {
    purpose_pair = unConstrData(purpose)
    purpose_tag = fstPair[Int,List[Data]](purpose_pair)
    purpose_fields = sndPair[Int,List[Data]](purpose_pair)

    if (equalsInteger(purpose_tag, 0)) {
        // minting
        headList(purpose_fields)
    } else if (equalsInteger(purpose_tag, 1)) {
        // spending validator credential
        input = find_input(unListData(headList(tx)), headList(purpose_fields))

        headList(sndPair[Int,List[Data]](unConstrData(headList(sndPair[Int,List[Data]](unConstrData(headList(sndPair[Int,List[Data]](unConstrData(headList(tailList(input)))))))))))
    } else if (equalsInteger(purpose_tag, 2)) {
        // rewarding
        headList(sndPair[Int,List[Data]](unConstrData(headList(sndPair[Int,List[Data]](unConstrData(headList(purpose_fields)))))))
    } else if (equalsInteger(purpose_tag, 3)) {
        // certifying
        cert = headList(tailList(purpose_fields))
        cert_pair = unConstrData(cert)
        cert_tag = fstPair[Int,List[Data]](cert_pair)
        cert_fields = sndPair[Int,List[Data]](cert_pair)

        if (lessThanInteger(cert_tag, 4)) {
            headList(sndPair[Int,List[Data]](unConstrData(headList(cert_fields))))
        } else {
            headList(sndPair[Int,List[Data]](unConstrData(headList(sndPair[Int,List[Data]](unConstrData(headList(cert_fields)))))))
        }
    } else if (equalsInteger(purpose_tag, 4)) {
        // voting
        headList(sndPair[Int,List[Data]](unConstrData(headList(sndPair[Int,List[Data]](unConstrData(headList(sndPair[Int,List[Data]](unConstrData(headList(purpose_fields))))))))))
    } else {
        error()
    }
}

find_input = (inputs: List[Data], ref: Data): List[Data] -> {
    input = sndPair[Int,List[Data]](unConstrData(headList(inputs)))

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

get_pair = (inputs: List[Pair[Data, Data]], index: Int, running_idx: Int): Pair[Data, Data] -> {
    if (equalsInteger(index, running_idx)) {
        headList(inputs)
    } else {
        get_pair(inputs, index, addInteger(running_idx, 1))
    }
}

assets_contain = (assets: List[Pair[Data, Data]], policy: Data): Bool -> {
    if (nullList(assets)) {
        false
    } else {
        entry = headList(assets)

        if (equalsData(fstPair[Data,Data](entry), policy)) {
            true
        } else {
            assets_contain(tailList(assets), policy)
        }
    }
}`

describe("anchor", () => {
  it("compiles the embedded validator source", () => {
    const entryPoints = compile([
      {
        name: "anchor.hl",
        content: src
      }
    ])

    expect(entryPoints["anchor::main"]).toBeDefined()
  })
})
